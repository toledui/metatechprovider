import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertSameOrigin, requireAuth } from "../auth/session.js";
import { Prisma } from "../generated/prisma/client.js";
import { WebhookDeliveryStatus, WebhookDirection, WebhookSource, WhatsAppConnectionStatus } from "../generated/prisma/enums.js";
import { metaPayload, outboundMessageSchema } from "../gateway/message-schema.js";
import { sendMetaMessage, type MetaMessageFetcher } from "../gateway/meta-messages.js";
import { inboxAuditData } from "../inbox/audit.js";
import { requireInboxPermission } from "../inbox/permissions.js";
import { ensureOutboundConversation, persistOutboundInboxMessage } from "../inbox/outbound.js";
import { publishInboxEvent } from "../inbox/realtime.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createMetaTemplate, deleteMetaTemplate, listMetaTemplates, type MetaTemplateFetcher, updateMetaTemplate } from "../meta/templates.js";

const templateIdSchema = z.object({ templateId: z.string().min(1).max(30) });
const listSchema = z.object({ connectionId: z.string().min(1).max(30).optional(), status: z.string().max(40).optional() });
const templateSchema = z.object({
  connectionId: z.string().min(1).max(30),
  name: z.string().regex(/^[a-z0-9_]+$/).max(512),
  language: z.string().min(2).max(35),
  category: z.enum(["AUTHENTICATION", "MARKETING", "UTILITY"]),
  components: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
});
const updateSchema = z.object({
  category: z.enum(["AUTHENTICATION", "MARKETING", "UTILITY"]).optional(),
  components: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
});
const syncSchema = z.object({ connectionId: z.string().min(1).max(30) });
const sendTemplateSchema = z.object({
  to: z.string().trim().min(7).max(32),
  templateId: z.string().min(1).max(30),
  variables: z.array(z.string().max(1024)).max(20).default([]),
});

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function quality(value: unknown): string | null {
  if (typeof value === "string") return value;
  const score = object(value)?.score;
  return typeof score === "string" ? score : null;
}

function bodyText(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  const body = components.map(object).find((component) => String(component?.type).toUpperCase() === "BODY");
  return typeof body?.text === "string" ? body.text : null;
}

function variableCount(components: unknown): number {
  const text = bodyText(components) ?? "";
  return [...text.matchAll(/\{\{(\d+)\}\}/g)].reduce((max, match) => Math.max(max, Number(match[1])), 0);
}

function publicTemplate(template: {
  publicId: string; name: string; language: string; category: string; status: string; qualityScore: string | null;
  rejectionReason: string | null; components: unknown; lastSyncedAt: Date;
  connection: { publicId: string; verifiedName: string | null; displayPhoneNumber: string | null };
}) {
  return {
    id: template.publicId,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    qualityScore: template.qualityScore,
    rejectionReason: template.rejectionReason,
    components: template.components,
    preview: bodyText(template.components),
    variableCount: variableCount(template.components),
    lastSyncedAt: template.lastSyncedAt.toISOString(),
    connection: { id: template.connection.publicId, name: template.connection.verifiedName ?? template.connection.displayPhoneNumber ?? "WhatsApp" },
  };
}

async function ownedConnection(tenantId: bigint, publicId: string) {
  const connection = await prisma.whatsAppConnection.findFirst({ where: {
    tenantId, publicId, status: WhatsAppConnectionStatus.ACTIVE, deletedAt: null,
  } });
  if (!connection) throw new AppError(404, "connection_not_found", "No existe una conexión activa con ese identificador.");
  return connection;
}

export interface TemplateRoutesOptions {
  metaTemplateFetcher?: MetaTemplateFetcher;
  metaMessageFetcher?: MetaMessageFetcher;
}

export async function templateRoutes(app: FastifyInstance, options: TemplateRoutesOptions): Promise<void> {
  app.get("/api/whatsapp/templates", async (request) => {
    const auth = await requireAuth(request);
    const query = listSchema.safeParse(request.query);
    if (!query.success) throw new AppError(422, "validation_error", "Los filtros de plantillas no son válidos.");
    const templates = await prisma.whatsAppTemplate.findMany({
      where: { tenantId: auth.tenantId, ...(query.data.connectionId ? { connection: { publicId: query.data.connectionId } } : {}), ...(query.data.status ? { status: query.data.status } : {}) },
      include: { connection: { select: { publicId: true, verifiedName: true, displayPhoneNumber: true } } },
      orderBy: [{ name: "asc" }, { language: "asc" }],
    });
    return { templates: templates.map(publicTemplate) };
  });

  app.post("/api/whatsapp/templates/sync", async (request) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "manageTemplates", auth.inboxPermissions);
    const body = syncSchema.safeParse(request.body);
    if (!body.success) throw new AppError(422, "validation_error", "Selecciona una conexión válida.");
    const connection = await ownedConnection(auth.tenantId, body.data.connectionId);
    const remote = await listMetaTemplates(connection, options.metaTemplateFetcher);
    const syncedAt = new Date();
    await prisma.$transaction(async (transaction) => {
      const keys: Array<{ name: string; language: string }> = [];
      for (const template of remote) {
        if (!template.name || !template.language || !template.category || !Array.isArray(template.components)) continue;
        keys.push({ name: template.name, language: template.language });
        await transaction.whatsAppTemplate.upsert({
          where: { connectionId_name_language: { connectionId: connection.id, name: template.name, language: template.language } },
          create: {
            tenantId: auth.tenantId, connectionId: connection.id, metaTemplateId: template.id ?? null,
            name: template.name, language: template.language, category: template.category, status: template.status ?? "UNKNOWN",
            qualityScore: quality(template.quality_score), rejectionReason: template.rejected_reason ?? null,
            components: template.components, rawPayload: template as Prisma.InputJsonValue, lastSyncedAt: syncedAt,
          },
          update: {
            metaTemplateId: template.id ?? null, category: template.category, status: template.status ?? "UNKNOWN",
            qualityScore: quality(template.quality_score), rejectionReason: template.rejected_reason ?? null,
            components: template.components, rawPayload: template as Prisma.InputJsonValue, lastSyncedAt: syncedAt,
          },
        });
      }
      await transaction.whatsAppTemplate.updateMany({
        where: { connectionId: connection.id, ...(keys.length ? { NOT: { OR: keys } } : {}) },
        data: { status: "DELETED", lastSyncedAt: syncedAt },
      });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "whatsapp.templates.synced", entityType: "whatsapp_connection", entityPublicId: connection.publicId,
        metadata: { count: remote.length }, ipAddress: request.ip }) });
    });
    return { synchronized: remote.length };
  });

  app.post("/api/whatsapp/templates", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "manageTemplates", auth.inboxPermissions);
    const body = templateSchema.safeParse(request.body);
    if (!body.success) throw new AppError(422, "validation_error", "La plantilla no tiene un formato válido.", body.error.flatten());
    const connection = await ownedConnection(auth.tenantId, body.data.connectionId);
    const result = await createMetaTemplate(connection, {
      name: body.data.name, language: body.data.language, category: body.data.category, components: body.data.components,
    }, options.metaTemplateFetcher);
    const template = await prisma.$transaction(async (transaction) => {
      const saved = await transaction.whatsAppTemplate.upsert({
        where: { connectionId_name_language: { connectionId: connection.id, name: body.data.name, language: body.data.language } },
        create: { tenantId: auth.tenantId, connectionId: connection.id, metaTemplateId: typeof result.id === "string" ? result.id : null,
          name: body.data.name, language: body.data.language, category: body.data.category,
          status: typeof result.status === "string" ? result.status : "PENDING", components: body.data.components as Prisma.InputJsonValue, rawPayload: result as Prisma.InputJsonValue },
        update: { metaTemplateId: typeof result.id === "string" ? result.id : null, category: body.data.category,
          status: typeof result.status === "string" ? result.status : "PENDING", components: body.data.components as Prisma.InputJsonValue, rawPayload: result as Prisma.InputJsonValue, lastSyncedAt: new Date() },
        include: { connection: { select: { publicId: true, verifiedName: true, displayPhoneNumber: true } } },
      });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "whatsapp.template.created", entityType: "whatsapp_template", entityPublicId: saved.publicId,
        metadata: { name: saved.name, language: saved.language, category: saved.category }, ipAddress: request.ip }) });
      return saved;
    });
    reply.status(201);
    const complete = await prisma.whatsAppTemplate.findUniqueOrThrow({ where: { id: template.id }, include: { connection: { select: { publicId: true, verifiedName: true, displayPhoneNumber: true } } } });
    return { template: publicTemplate(complete) };
  });

  app.patch("/api/whatsapp/templates/:templateId", async (request) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "manageTemplates", auth.inboxPermissions);
    const params = templateIdSchema.safeParse(request.params);
    const body = updateSchema.safeParse(request.body);
    if (!params.success || !body.success) throw new AppError(422, "validation_error", "La actualización de plantilla no es válida.");
    const template = await prisma.whatsAppTemplate.findFirst({ where: { publicId: params.data.templateId, tenantId: auth.tenantId }, include: { connection: true } });
    if (!template || !template.metaTemplateId) throw new AppError(404, "template_not_found", "La plantilla no existe o aún no tiene ID de Meta.");
    const result = await updateMetaTemplate(template.connection, template.metaTemplateId, {
      ...(body.data.category ? { category: body.data.category } : {}), components: body.data.components,
    }, options.metaTemplateFetcher);
    const updated = await prisma.$transaction(async (transaction) => {
      const saved = await transaction.whatsAppTemplate.update({ where: { id: template.id }, data: {
        ...(body.data.category ? { category: body.data.category } : {}), components: body.data.components as Prisma.InputJsonValue,
        status: typeof result.status === "string" ? result.status : "PENDING", rawPayload: result as Prisma.InputJsonValue, lastSyncedAt: new Date(),
      }, include: { connection: { select: { publicId: true, verifiedName: true, displayPhoneNumber: true } } } });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "whatsapp.template.updated", entityType: "whatsapp_template", entityPublicId: saved.publicId,
        metadata: { status: saved.status }, ipAddress: request.ip }) });
      return saved;
    });
    const complete = await prisma.whatsAppTemplate.findUniqueOrThrow({ where: { id: updated.id }, include: { connection: { select: { publicId: true, verifiedName: true, displayPhoneNumber: true } } } });
    return { template: publicTemplate(complete) };
  });

  app.delete("/api/whatsapp/templates/:templateId", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "manageTemplates", auth.inboxPermissions);
    const params = templateIdSchema.safeParse(request.params);
    if (!params.success) throw new AppError(422, "validation_error", "Plantilla inválida.");
    const template = await prisma.whatsAppTemplate.findFirst({ where: { publicId: params.data.templateId, tenantId: auth.tenantId }, include: { connection: true } });
    if (!template) throw new AppError(404, "template_not_found", "La plantilla no existe.");
    await deleteMetaTemplate(template.connection, template.name, options.metaTemplateFetcher);
    await prisma.$transaction([
      prisma.whatsAppTemplate.update({ where: { id: template.id }, data: { status: "DELETED", lastSyncedAt: new Date() } }),
      prisma.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "whatsapp.template.deleted", entityType: "whatsapp_template", entityPublicId: template.publicId,
        metadata: { name: template.name, language: template.language }, ipAddress: request.ip }) }),
    ]);
    return reply.status(204).send();
  });

  async function sendTemplate(request: FastifyRequest, reply: FastifyReply) {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "sendMessages", auth.inboxPermissions);
    const body = sendTemplateSchema.safeParse(request.body);
    if (!body.success) throw new AppError(422, "validation_error", "Destino, plantilla o variables inválidas.", body.error.flatten());
    const template = await prisma.whatsAppTemplate.findFirst({ where: {
      publicId: body.data.templateId, tenantId: auth.tenantId, status: "APPROVED",
      connection: { status: WhatsAppConnectionStatus.ACTIVE, deletedAt: null },
    }, include: { connection: true } });
    if (!template) throw new AppError(404, "approved_template_not_found", "Selecciona una plantilla aprobada y sincronizada.");
    const expected = variableCount(template.components);
    if (body.data.variables.length !== expected) throw new AppError(422, "template_variables_mismatch", `La plantilla requiere ${expected} variable(s).`);
    const components = expected ? [{ type: "body", parameters: body.data.variables.map((text) => ({ type: "text", text })) }] : undefined;
    const parsed = outboundMessageSchema.safeParse({
      to: body.data.to, connection_id: template.connection.publicId, type: "template",
      template: { name: template.name, language: template.language, ...(components ? { components } : {}) },
    });
    if (!parsed.success) throw new AppError(422, "validation_error", "El número o las variables no son válidos.", parsed.error.flatten());
    const conversation = await ensureOutboundConversation(auth.tenantId, template.connectionId, parsed.data.to);
    const payload = metaPayload(parsed.data);
    let result;
    try {
      result = await sendMetaMessage(template.connection, payload, options.metaMessageFetcher);
    } catch (error) {
      const createdAt = new Date();
      const errorMessage = error instanceof Error ? error.message.slice(0, 2_000) : "Error de red con Meta.";
      const failed = await prisma.$transaction(async (transaction) => {
        const saved = await persistOutboundInboxMessage(transaction, { conversation, message: parsed.data,
          payload: payload as Prisma.InputJsonValue, externalId: null, senderUserId: auth.userId,
          succeeded: false, errorMessage, createdAt });
        await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
          action: "whatsapp.template.send_failed", entityType: "whatsapp_template", entityPublicId: template.publicId,
          metadata: { conversationId: conversation.publicId, messageId: saved.publicId }, ipAddress: request.ip }) });
        return saved;
      });
      publishInboxEvent(auth.tenantId, { type: "message.updated", conversationId: conversation.publicId });
      throw new AppError(502, "meta_unavailable", "No fue posible comunicarse con Meta.", { messageId: failed.publicId, conversationId: conversation.publicId });
    }
    const externalId = Array.isArray(result.body.messages) && object(result.body.messages[0])?.id ? String(object(result.body.messages[0])?.id) : null;
    const createdAt = new Date();
    const message = await prisma.$transaction(async (transaction) => {
      const saved = await persistOutboundInboxMessage(transaction, { conversation, message: parsed.data, payload: payload as Prisma.InputJsonValue,
        externalId, senderUserId: auth.userId, succeeded: result.ok, errorMessage: result.ok ? null : "Meta rechazó la plantilla.", createdAt });
      await transaction.webhookLog.create({ data: { tenantId: auth.tenantId, connectionId: template.connectionId, actorUserId: auth.userId,
        direction: WebhookDirection.OUTBOUND, source: WebhookSource.INTERNAL, eventType: "inbox.template.test", externalEventId: externalId,
        status: result.ok ? WebhookDeliveryStatus.SUCCEEDED : WebhookDeliveryStatus.FAILED, targetUrl: result.targetUrl,
        requestPayload: payload as Prisma.InputJsonValue, responsePayload: result.body as Prisma.InputJsonValue, httpStatus: result.status,
        attemptCount: 1, durationMs: result.durationMs, errorMessage: result.ok ? null : "Meta rechazó la plantilla.", processedAt: createdAt } });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: result.ok ? "whatsapp.template.sent" : "whatsapp.template.send_failed", entityType: "whatsapp_template", entityPublicId: template.publicId,
        metadata: { conversationId: conversation.publicId, messageId: saved.publicId }, ipAddress: request.ip }) });
      return saved;
    });
    publishInboxEvent(auth.tenantId, { type: "message.updated", conversationId: conversation.publicId });
    if (!result.ok) throw new AppError(502, "meta_request_failed", "Meta rechazó el envío de la plantilla.", result.body);
    reply.status(201);
    return { conversationId: conversation.publicId, messageId: message.publicId };
  }

  app.post("/api/inbox/conversations", sendTemplate);
  app.post("/api/whatsapp/templates/:templateId/test", async (request, reply) => {
    const params = templateIdSchema.safeParse(request.params);
    if (!params.success) throw new AppError(422, "validation_error", "Plantilla inválida.");
    request.body = { ...(object(request.body) ?? {}), templateId: params.data.templateId };
    return sendTemplate(request, reply);
  });
}
