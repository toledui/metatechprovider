import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { MESSAGE_SEND_SCOPE, requireApiKey } from "../api-keys/service.js";
import { env } from "../config/env.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  WebhookDeliveryStatus,
  WebhookDirection,
  WebhookSource,
  WhatsAppConnectionStatus,
} from "../generated/prisma/enums.js";
import { metaPayload, outboundMessageSchema } from "../gateway/message-schema.js";
import { sendMetaMessage, type MetaMessageFetcher } from "../gateway/meta-messages.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../lib/security.js";

const idempotencySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:\-]+$/);

interface StoredGatewayResponse {
  httpStatus: number;
  body: Record<string, unknown>;
}

export interface GatewayRoutesOptions {
  metaMessageFetcher?: MetaMessageFetcher;
}

function isStoredResponse(value: unknown): value is StoredGatewayResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.httpStatus === "number" && Boolean(record.body) && typeof record.body === "object";
}

function sendStored(reply: FastifyReply, value: unknown) {
  if (!isStoredResponse(value)) {
    throw new AppError(409, "idempotency_in_progress", "Ya existe una solicitud con esta clave de idempotencia.");
  }
  reply.header("Idempotency-Replayed", "true");
  return reply.status(value.httpStatus).send(value.body);
}

export async function gatewayRoutes(app: FastifyInstance, options: GatewayRoutesOptions): Promise<void> {
  app.post("/api/v1/messages/send", async (request, reply) => {
    const auth = await requireApiKey(request, MESSAGE_SEND_SCOPE);
    const idempotency = idempotencySchema.safeParse(request.headers["idempotency-key"]);
    if (!idempotency.success) {
      throw new AppError(400, "idempotency_key_required", "Envía un header Idempotency-Key de 8 a 128 caracteres.");
    }
    const parsed = outboundMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, "validation_error", "El mensaje no tiene un formato válido.", parsed.error.flatten());
    }

    const deduplicationKey = sha256(`outbound:${auth.apiKeyId}:${idempotency.data}`);
    const previous = await prisma.webhookLog.findUnique({ where: { deduplicationKey } });
    if (previous) return sendStored(reply, previous.responsePayload);

    const activeConnections = await prisma.whatsAppConnection.findMany({
      where: {
        tenantId: auth.tenantId,
        status: WhatsAppConnectionStatus.ACTIVE,
        deletedAt: null,
        ...(parsed.data.connection_id ? { publicId: parsed.data.connection_id } : {}),
      },
      take: parsed.data.connection_id ? 1 : 2,
    });
    if (activeConnections.length === 0) {
      throw new AppError(409, "active_connection_not_found", "No existe una conexión activa para enviar el mensaje.");
    }
    if (!parsed.data.connection_id && activeConnections.length > 1) {
      throw new AppError(422, "connection_id_required", "Este tenant tiene varias líneas activas; indica connection_id.");
    }
    const connection = activeConnections[0]!;

    const windowStart = new Date(Date.now() - 60_000);
    const used = await prisma.webhookLog.count({
      where: {
        apiKeyId: auth.apiKeyId,
        direction: WebhookDirection.OUTBOUND,
        source: WebhookSource.API_GATEWAY,
        receivedAt: { gte: windowStart },
      },
    });
    const remaining = Math.max(0, env.apiRateLimitPerMinute - used - 1);
    reply.header("X-RateLimit-Limit", String(env.apiRateLimitPerMinute));
    reply.header("X-RateLimit-Remaining", String(remaining));
    if (used >= env.apiRateLimitPerMinute) {
      reply.header("Retry-After", "60");
      throw new AppError(429, "rate_limit_exceeded", "Se alcanzó el límite de mensajes por minuto para esta API Key.");
    }

    const outboundPayload = metaPayload(parsed.data);
    let log;
    try {
      log = await prisma.webhookLog.create({
        data: {
          tenantId: auth.tenantId,
          connectionId: connection.id,
          apiKeyId: auth.apiKeyId,
          direction: WebhookDirection.OUTBOUND,
          source: WebhookSource.API_GATEWAY,
          eventType: `message.${parsed.data.type}`,
          deduplicationKey,
          status: WebhookDeliveryStatus.PROCESSING,
          requestPayload: outboundPayload as Prisma.InputJsonValue,
          attemptCount: 1,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        const concurrent = await prisma.webhookLog.findUnique({ where: { deduplicationKey } });
        if (concurrent) return sendStored(reply, concurrent.responsePayload);
      }
      throw error;
    }

    try {
      const result = await sendMetaMessage(connection, outboundPayload, options.metaMessageFetcher);
      const messageId = Array.isArray(result.body.messages) && result.body.messages[0] &&
        typeof result.body.messages[0] === "object" && "id" in result.body.messages[0]
        ? String((result.body.messages[0] as { id: unknown }).id)
        : null;
      const responseStatus = result.ok ? 200 : 502;
      const responseBody = result.ok
        ? {
            success: true,
            request_id: log.publicId,
            message_id: messageId,
            meta: result.body,
          }
        : {
            success: false,
            error: "meta_request_failed",
            message: "Meta rechazó la solicitud de envío.",
            request_id: log.publicId,
            meta: result.body,
          };

      await prisma.webhookLog.update({
        where: { id: log.id },
        data: {
          status: result.ok ? WebhookDeliveryStatus.SUCCEEDED : WebhookDeliveryStatus.FAILED,
          targetUrl: result.targetUrl,
          externalEventId: messageId,
          httpStatus: result.status,
          durationMs: result.durationMs,
          responsePayload: { httpStatus: responseStatus, body: responseBody } as Prisma.InputJsonValue,
          errorMessage: result.ok ? null : "Meta rechazó la solicitud de envío.",
        },
      });
      return reply.status(responseStatus).send(responseBody);
    } catch (error) {
      const responseBody = {
        success: false,
        error: "meta_unavailable",
        message: "No fue posible comunicarse con Meta.",
        request_id: log.publicId,
      };
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: {
          status: WebhookDeliveryStatus.FAILED,
          responsePayload: { httpStatus: 502, body: responseBody },
          errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "Error de red con Meta.",
        },
      });
      return reply.status(502).send(responseBody);
    }
  });
}
