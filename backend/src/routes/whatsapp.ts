import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSameOrigin, requireAuth } from "../auth/session.js";
import {
  MetaTokenType,
  TenantStatus,
  UserRole,
  WebhookDeliveryStatus,
  WebhookDirection,
  WebhookSource,
  WhatsAppConnectionStatus,
} from "../generated/prisma/enums.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createOpaqueToken, encryptCredential } from "../lib/security.js";
import { completeEmbeddedSignup } from "../meta/client.js";
import { env } from "../config/env.js";

const callbackSchema = z.object({
  code: z.string().min(8).max(4096),
  wabaId: z.string().max(64).optional(),
  phoneNumberId: z.string().max(64).optional(),
  businessId: z.string().max(64).optional(),
  coexistence: z.boolean().default(true),
});

const connectionParamsSchema = z.object({ connectionId: z.string().min(1).max(30) });
const webhookConfigSchema = z.object({
  webhookUrl: z.union([z.url().max(2048), z.null()]),
  regenerateSecret: z.boolean().default(false),
});
const webhookLogsQuerySchema = z.object({
  connectionId: z.string().min(1).max(30).optional(),
  status: z.enum(WebhookDeliveryStatus).optional(),
  take: z.coerce.number().int().min(1).max(100).default(30),
});

function publicConnection(connection: {
  publicId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: WhatsAppConnectionStatus;
  coexistenceEnabled: boolean;
  connectedAt: Date | null;
  webhookUrl: string | null;
  webhookSecretEncrypted: string | null;
}) {
  return {
    id: connection.publicId,
    wabaId: connection.wabaId,
    phoneNumberId: connection.phoneNumberId,
    displayPhoneNumber: connection.displayPhoneNumber,
    verifiedName: connection.verifiedName,
    status: connection.status,
    coexistenceEnabled: connection.coexistenceEnabled,
    connectedAt: connection.connectedAt?.toISOString() ?? null,
    webhookUrl: connection.webhookUrl,
    webhookSecretConfigured: Boolean(connection.webhookSecretEncrypted),
  };
}

function assertCanManageConnection(userRole: string): void {
  if (userRole !== UserRole.OWNER && userRole !== UserRole.ADMIN) {
    throw new AppError(403, "connection_admin_required", "Solo un owner o admin puede configurar webhooks.");
  }
}

function validateWebhookUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(env.nodeEnv !== "production" && url.protocol === "http:")) {
    throw new AppError(422, "https_webhook_required", "El webhook debe utilizar HTTPS en producción.");
  }
  if (url.username || url.password || url.hash) {
    throw new AppError(422, "invalid_webhook_url", "La URL no puede contener credenciales ni fragmentos.");
  }
  return url.toString();
}

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/whatsapp/connections", async (request) => {
    const auth = await requireAuth(request);
    const connections = await prisma.whatsAppConnection.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return { connections: connections.map(publicConnection) };
  });

  app.post("/api/auth/facebook/callback", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    const parsed = callbackSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, "validation_error", "La respuesta de Facebook no es válida.", parsed.error.flatten());
    }

    const onboarding = await completeEmbeddedSignup(parsed.data.code, {
      wabaId: parsed.data.wabaId,
      phoneNumberId: parsed.data.phoneNumberId,
      businessId: parsed.data.businessId,
    });
    const existing = await prisma.whatsAppConnection.findUnique({
      where: { phoneNumberId: onboarding.phone.id },
    });
    if (existing && existing.tenantId !== auth.tenantId) {
      throw new AppError(409, "phone_already_connected", "Este número ya pertenece a otro tenant.");
    }

    const encryptedToken = encryptCredential(onboarding.accessToken);
    const data = {
      tenantId: auth.tenantId,
      wabaId: onboarding.wabaId,
      displayPhoneNumber: onboarding.phone.display_phone_number ?? null,
      verifiedName: onboarding.phone.verified_name ?? null,
      accessTokenEncrypted: encryptedToken,
      tokenType: MetaTokenType.SYSTEM_USER,
      tokenExpiresAt: onboarding.expiresAt ?? null,
      status: WhatsAppConnectionStatus.ACTIVE,
      coexistenceEnabled: parsed.data.coexistence,
      metaBusinessId: onboarding.businessId ?? null,
      metaUserId: onboarding.metaUserId ?? null,
      metadata: {
        qualityRating: onboarding.phone.quality_rating ?? null,
        platformType: onboarding.phone.platform_type ?? null,
      },
      connectedAt: new Date(),
      deletedAt: null,
      lastErrorAt: null,
    };

    const connection = existing
      ? await prisma.whatsAppConnection.update({ where: { id: existing.id }, data })
      : await prisma.whatsAppConnection.create({
          data: { ...data, phoneNumberId: onboarding.phone.id },
        });

    await prisma.tenant.update({
      where: { id: auth.tenantId },
      data: { status: TenantStatus.ACTIVE },
    });

    reply.status(existing ? 200 : 201);
    return { connection: publicConnection(connection) };
  });

  app.put("/api/whatsapp/connections/:connectionId/webhook", async (request) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    assertCanManageConnection(auth.userRole);
    const params = connectionParamsSchema.safeParse(request.params);
    const body = webhookConfigSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      throw new AppError(422, "validation_error", "La configuración del webhook no es válida.");
    }

    const connection = await prisma.whatsAppConnection.findFirst({
      where: { publicId: params.data.connectionId, tenantId: auth.tenantId, deletedAt: null },
    });
    if (!connection) throw new AppError(404, "connection_not_found", "Conexión no encontrada.");

    if (body.data.webhookUrl === null) {
      const disabled = await prisma.whatsAppConnection.update({
        where: { id: connection.id },
        data: { webhookUrl: null, webhookSecretEncrypted: null },
      });
      return { connection: publicConnection(disabled), webhookSecret: null };
    }

    const webhookUrl = validateWebhookUrl(body.data.webhookUrl);
    const mustGenerateSecret = body.data.regenerateSecret || !connection.webhookSecretEncrypted;
    const webhookSecret = mustGenerateSecret ? createOpaqueToken() : null;
    const updated = await prisma.whatsAppConnection.update({
      where: { id: connection.id },
      data: {
        webhookUrl,
        ...(webhookSecret ? { webhookSecretEncrypted: encryptCredential(webhookSecret) } : {}),
      },
    });

    return { connection: publicConnection(updated), webhookSecret };
  });

  app.post("/api/whatsapp/connections/:connectionId/webhook/test", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    assertCanManageConnection(auth.userRole);
    const params = connectionParamsSchema.safeParse(request.params);
    if (!params.success) throw new AppError(422, "validation_error", "Conexión inválida.");

    const connection = await prisma.whatsAppConnection.findFirst({
      where: { publicId: params.data.connectionId, tenantId: auth.tenantId, deletedAt: null },
    });
    if (!connection) throw new AppError(404, "connection_not_found", "Conexión no encontrada.");
    if (!connection.webhookUrl || !connection.webhookSecretEncrypted) {
      throw new AppError(409, "webhook_not_configured", "Configura y guarda el webhook antes de probarlo.");
    }

    const log = await prisma.webhookLog.create({
      data: {
        tenantId: auth.tenantId,
        connectionId: connection.id,
        actorUserId: auth.userId,
        direction: WebhookDirection.OUTBOUND,
        source: WebhookSource.INTERNAL,
        eventType: "webhook.test",
        status: WebhookDeliveryStatus.RECEIVED,
        targetUrl: connection.webhookUrl,
        requestPayload: {
          object: "thagencia_webhook_test",
          connection: {
            id: connection.publicId,
            phone_number_id: connection.phoneNumberId,
          },
          sent_at: new Date().toISOString(),
        },
      },
    });
    reply.status(202);
    return { queued: true, eventId: log.publicId };
  });

  app.get("/api/whatsapp/webhooks/logs", async (request) => {
    const auth = await requireAuth(request);
    const query = webhookLogsQuerySchema.safeParse(request.query);
    if (!query.success) throw new AppError(422, "validation_error", "Filtros de webhooks inválidos.");

    let connectionId: bigint | undefined;
    if (query.data.connectionId) {
      const connection = await prisma.whatsAppConnection.findFirst({
        where: { publicId: query.data.connectionId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!connection) throw new AppError(404, "connection_not_found", "Conexión no encontrada.");
      connectionId = connection.id;
    }

    const logs = await prisma.webhookLog.findMany({
      where: {
        tenantId: auth.tenantId,
        ...(connectionId ? { connectionId } : {}),
        ...(query.data.status ? { status: query.data.status } : {}),
      },
      orderBy: { receivedAt: "desc" },
      take: query.data.take,
      include: { connection: { select: { publicId: true, displayPhoneNumber: true, phoneNumberId: true } } },
    });

    return {
      logs: logs.map((log) => ({
        id: log.publicId,
        connection: log.connection
          ? {
              id: log.connection.publicId,
              phone: log.connection.displayPhoneNumber ?? log.connection.phoneNumberId,
            }
          : null,
        direction: log.direction,
        source: log.source,
        eventType: log.eventType,
        status: log.status,
        attempts: log.attemptCount,
        httpStatus: log.httpStatus,
        error: log.errorMessage,
        receivedAt: log.receivedAt.toISOString(),
        processedAt: log.processedAt?.toISOString() ?? null,
      })),
    };
  });
}
