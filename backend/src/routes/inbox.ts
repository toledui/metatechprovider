import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSameOrigin, requireAuth } from "../auth/session.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  UserStatus,
  WebhookDeliveryStatus,
  WebhookDirection,
  WebhookSource,
  WhatsAppConnectionStatus,
} from "../generated/prisma/enums.js";
import { metaPayload, outboundMessageSchema } from "../gateway/message-schema.js";
import { sendMetaMessage, type MetaMessageFetcher } from "../gateway/meta-messages.js";
import { publishInboxEvent, subscribeToInbox } from "../inbox/realtime.js";
import { inboxAuditData } from "../inbox/audit.js";
import { requireInboxPermission, resolveInboxPermissions } from "../inbox/permissions.js";
import {
  CUSTOMER_SERVICE_WINDOW_MS,
  customerServiceWindowOpen,
  persistOutboundInboxMessage,
} from "../inbox/outbound.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { downloadMetaMedia } from "../meta/media.js";

const conversationParams = z.object({ conversationId: z.string().min(1).max(30) });
const tagParams = conversationParams.extend({ tagId: z.string().min(1).max(30) });
const listSchema = z.object({
  status: z.enum(ConversationStatus).optional(),
  assignedTo: z.string().max(30).optional(),
  team: z.string().trim().max(100).optional(),
  tag: z.string().max(30).optional(),
  unread: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).max(30).optional(),
  limit: z.coerce.number().int().min(10).max(100).default(40),
});
const detailQuerySchema = z.object({
  before: z.string().min(1).max(30).optional(),
  limit: z.coerce.number().int().min(20).max(100).default(50),
});
const statusSchema = z.object({ status: z.enum(ConversationStatus) });
const assignmentSchema = z.object({
  userId: z.string().min(1).max(30).nullable().optional(),
  teamId: z.string().min(1).max(30).nullable().optional(),
});
const messageParams = z.object({ messageId: z.string().min(1).max(30) });
const noteSchema = z.object({ body: z.string().trim().min(1).max(10_000) });
const tagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ff6b35"),
});
const attachTagSchema = z.object({ tagId: z.string().min(1).max(30) });
const contactSchema = z.object({
  name: z.string().trim().min(1).max(191).nullable().optional(),
  email: z.union([z.email().max(191), z.literal("")]).nullable().optional(),
  company: z.string().trim().max(191).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
});

const sendTextSchema = z.object({
  type: z.literal("text"),
  text: z.object({ body: z.string().trim().min(1).max(4096), preview_url: z.boolean().optional() }),
});
const sendTemplateSchema = z.object({
  type: z.literal("template"),
  template: z.object({
    name: z.string().regex(/^[a-z0-9_]+$/).max(512),
    language: z.string().min(2).max(35),
    components: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  }),
});
const mediaReference = z.object({ link: z.url().max(2048), caption: z.string().max(1024).optional() });
const sendImageSchema = z.object({ type: z.literal("image"), image: mediaReference });
const sendVideoSchema = z.object({ type: z.literal("video"), video: mediaReference });
const sendDocumentSchema = z.object({
  type: z.literal("document"),
  document: mediaReference.extend({ filename: z.string().min(1).max(240).optional() }),
});
const sendAudioSchema = z.object({ type: z.literal("audio"), audio: z.object({ link: z.url().max(2048) }) });
const sendSchema = z.discriminatedUnion("type", [
  sendTextSchema,
  sendTemplateSchema,
  sendImageSchema,
  sendVideoSchema,
  sendDocumentSchema,
  sendAudioSchema,
]);

function date(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function inboundMediaId(content: unknown, type: string): string | null {
  const media = object(object(content)?.[type.toLowerCase()]);
  return typeof media?.id === "string" && media.id ? media.id : null;
}

function windowState(lastInboundAt: Date | null) {
  const expiresAt = lastInboundAt ? new Date(lastInboundAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS) : null;
  return {
    open: Boolean(expiresAt && expiresAt.getTime() > Date.now()),
    expiresAt: date(expiresAt),
  };
}

function publicAssignment(assignment: {
  publicId: string;
  teamName: string | null;
  createdAt: Date;
  assignedUser: { publicId: string; name: string } | null;
  team?: { publicId: string; name: string; color: string } | null;
}) {
  return {
    id: assignment.publicId,
    teamName: assignment.team?.name ?? assignment.teamName,
    team: assignment.team ? { id: assignment.team.publicId, name: assignment.team.name, color: assignment.team.color } : null,
    createdAt: assignment.createdAt.toISOString(),
    user: assignment.assignedUser ? { id: assignment.assignedUser.publicId, name: assignment.assignedUser.name } : null,
  };
}

function publicSummary(conversation: {
  publicId: string;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastMessagePreview: string | null;
  contact: { publicId: string; waId: string; name: string | null; profileName: string | null };
  connection: { publicId: string; displayPhoneNumber: string | null; verifiedName: string | null };
  tags: { publicId: string; name: string; color: string }[];
  assignments: {
    publicId: string;
    teamName: string | null;
    createdAt: Date;
    assignedUser: { publicId: string; name: string } | null;
    team?: { publicId: string; name: string; color: string } | null;
  }[];
}) {
  return {
    id: conversation.publicId,
    status: conversation.status,
    unreadCount: conversation.unreadCount,
    lastMessageAt: date(conversation.lastMessageAt),
    lastMessagePreview: conversation.lastMessagePreview,
    contact: {
      id: conversation.contact.publicId,
      waId: conversation.contact.waId,
      name: conversation.contact.name ?? conversation.contact.profileName ?? conversation.contact.waId,
    },
    connection: {
      id: conversation.connection.publicId,
      name: conversation.connection.verifiedName ?? conversation.connection.displayPhoneNumber ?? "WhatsApp",
    },
    tags: conversation.tags.map((tag) => ({ id: tag.publicId, name: tag.name, color: tag.color })),
    assignment: conversation.assignments[0] ? publicAssignment(conversation.assignments[0]) : null,
    window: windowState(conversation.lastInboundAt),
  };
}

async function ownedConversation(tenantId: bigint, publicId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { publicId, tenantId },
    include: { contact: true, connection: true },
  });
  if (!conversation) throw new AppError(404, "conversation_not_found", "La conversación no existe.");
  return conversation;
}

export interface InboxRoutesOptions {
  metaMessageFetcher?: MetaMessageFetcher;
}

export async function inboxRoutes(app: FastifyInstance, options: InboxRoutesOptions): Promise<void> {
  app.get("/api/inbox", async (request) => {
    const auth = await requireAuth(request);
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) throw new AppError(422, "validation_error", "Los filtros del inbox no son válidos.");
    const query = parsed.data;
    let assignedUserId: bigint | undefined;
    if (query.assignedTo && query.assignedTo !== "unassigned") {
      if (query.assignedTo === "me") assignedUserId = auth.userId;
      else {
        const user = await prisma.user.findFirst({ where: { tenantId: auth.tenantId, publicId: query.assignedTo } });
        if (!user) return { conversations: [], nextCursor: null, agents: [], teams: [], tags: [], permissions: resolveInboxPermissions(auth.userRole, auth.inboxPermissions) };
        assignedUserId = user.id;
      }
    }
    const assignmentFilters: Prisma.ConversationWhereInput[] = [];
    if (query.team) assignmentFilters.push({ assignments: { some: { endedAt: null, OR: [{ team: { publicId: query.team } }, { teamName: query.team }] } } });
    if (query.assignedTo === "unassigned") assignmentFilters.push({ assignments: { none: { endedAt: null } } });
    if (assignedUserId) assignmentFilters.push({ assignments: { some: { endedAt: null, assignedUserId } } });
    const where: Prisma.ConversationWhereInput = {
      tenantId: auth.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.unread === "true" ? { unreadCount: { gt: 0 } } : {}),
      ...(query.unread === "false" ? { unreadCount: 0 } : {}),
      ...(query.tag ? { tags: { some: { publicId: query.tag, tenantId: auth.tenantId } } } : {}),
      ...(assignmentFilters.length ? { AND: assignmentFilters } : {}),
      ...(query.search ? {
        OR: [
          { contact: { name: { contains: query.search } } },
          { contact: { profileName: { contains: query.search } } },
          { contact: { waId: { contains: query.search } } },
          { lastMessagePreview: { contains: query.search } },
        ],
      } : {}),
    };
    const [conversationRows, agents, tags, teams] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: true,
          connection: true,
          tags: true,
          assignments: {
            where: { endedAt: null },
            include: { assignedUser: { select: { publicId: true, name: true } }, team: { select: { publicId: true, name: true, color: true } } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        ...(query.cursor ? { cursor: { publicId: query.cursor }, skip: 1 } : {}),
        take: query.limit + 1,
      }),
      prisma.user.findMany({
        where: { tenantId: auth.tenantId, status: UserStatus.ACTIVE, deletedAt: null },
        select: { publicId: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      prisma.tag.findMany({ where: { tenantId: auth.tenantId }, orderBy: { name: "asc" } }),
      prisma.inboxTeam.findMany({
        where: { tenantId: auth.tenantId },
        select: { publicId: true, name: true, color: true, members: { select: { user: { select: { publicId: true } } } } },
        orderBy: { name: "asc" },
      }),
    ]);
    const hasMore = conversationRows.length > query.limit;
    const conversations = hasMore ? conversationRows.slice(0, query.limit) : conversationRows;
    return {
      conversations: conversations.map(publicSummary),
      nextCursor: hasMore ? conversations.at(-1)?.publicId ?? null : null,
      agents: agents.map((agent) => ({ id: agent.publicId, name: agent.name, role: agent.role })),
      teams: teams.map((team) => ({ id: team.publicId, name: team.name, color: team.color, memberIds: team.members.map((membership) => membership.user.publicId) })),
      tags: tags.map((tag) => ({ id: tag.publicId, name: tag.name, color: tag.color })),
      permissions: resolveInboxPermissions(auth.userRole, auth.inboxPermissions),
    };
  });

  app.get("/api/inbox/conversations/:conversationId", async (request) => {
    const auth = await requireAuth(request);
    const params = conversationParams.safeParse(request.params);
    const query = detailQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) throw new AppError(422, "validation_error", "Conversación o paginación inválida.");
    const conversation = await prisma.conversation.findFirst({
      where: { publicId: params.data.conversationId, tenantId: auth.tenantId },
      include: {
        contact: true,
        connection: true,
        tags: true,
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          ...(query.data.before ? { cursor: { publicId: query.data.before }, skip: 1 } : {}),
          take: query.data.limit + 1,
        },
        assignments: {
          where: { endedAt: null },
          include: { assignedUser: { select: { publicId: true, name: true } }, team: { select: { publicId: true, name: true, color: true } } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        internalNotes: {
          include: { author: { select: { publicId: true, name: true } } },
          orderBy: { createdAt: "desc" },
          take: 100,
        },
      },
    });
    if (!conversation) throw new AppError(404, "conversation_not_found", "La conversación no existe.");
    if (conversation.unreadCount > 0) {
      await prisma.conversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
    }
    const hasOlderMessages = conversation.messages.length > query.data.limit;
    const messages = (hasOlderMessages ? conversation.messages.slice(0, query.data.limit) : conversation.messages).reverse();
    return {
      conversation: {
        ...publicSummary(conversation),
        contact: {
          id: conversation.contact.publicId,
          waId: conversation.contact.waId,
          name: conversation.contact.name ?? conversation.contact.profileName ?? conversation.contact.waId,
          profileName: conversation.contact.profileName,
          email: conversation.contact.email,
          company: conversation.contact.company,
          notes: conversation.contact.notes,
        },
        messages: messages.map((message) => ({
          id: message.publicId,
          externalId: message.externalId,
          direction: message.direction,
          type: message.type,
          status: message.status,
          text: message.textBody,
          content: message.content,
          error: message.errorMessage,
          createdAt: message.createdAt.toISOString(),
          sentAt: date(message.sentAt),
          deliveredAt: date(message.deliveredAt),
          readAt: date(message.readAt),
          mediaUrl: message.direction === MessageDirection.INBOUND && ["IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "STICKER"].includes(message.type)
            ? `/api/inbox/messages/${message.publicId}/media`
            : null,
        })),
        nextBefore: hasOlderMessages ? messages[0]?.publicId ?? null : null,
        notes: conversation.internalNotes.map((note) => ({
          id: note.publicId,
          body: note.body,
          createdAt: note.createdAt.toISOString(),
          author: { id: note.author.publicId, name: note.author.name },
        })),
      },
    };
  });

  app.patch("/api/inbox/conversations/:conversationId/status", async (request) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "changeStatus", auth.inboxPermissions);
    const params = conversationParams.safeParse(request.params);
    const body = statusSchema.safeParse(request.body);
    if (!params.success || !body.success) throw new AppError(422, "validation_error", "Estado o conversación inválidos.");
    const conversation = await ownedConversation(auth.tenantId, params.data.conversationId);
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.conversation.update({
        where: { id: conversation.id },
        data: {
          status: body.data.status,
          resolvedAt: body.data.status === ConversationStatus.RESOLVED ? new Date() : null,
        },
      });
      await transaction.auditLog.create({ data: inboxAuditData({
        tenantId: auth.tenantId, actorUserId: auth.userId, action: "inbox.conversation.status_changed",
        entityType: "conversation", entityPublicId: conversation.publicId,
        metadata: { from: conversation.status, to: body.data.status }, ipAddress: request.ip,
      }) });
      return result;
    });
    publishInboxEvent(auth.tenantId, { type: "conversation.updated", conversationId: conversation.publicId });
    return { status: updated.status };
  });

  app.post("/api/inbox/conversations/:conversationId/assignment", async (request) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "assignConversations", auth.inboxPermissions);
    const params = conversationParams.safeParse(request.params);
    const body = assignmentSchema.safeParse(request.body);
    if (!params.success || !body.success) throw new AppError(422, "validation_error", "Asignación inválida.");
    const conversation = await ownedConversation(auth.tenantId, params.data.conversationId);
    const userPublicId = body.data.userId || null;
    const team = body.data.teamId ? await prisma.inboxTeam.findFirst({
      where: { publicId: body.data.teamId, tenantId: auth.tenantId },
    }) : null;
    if (body.data.teamId && !team) throw new AppError(422, "invalid_team", "El equipo seleccionado no existe.");
    const assignedUser = userPublicId ? await prisma.user.findFirst({
      where: { publicId: userPublicId, tenantId: auth.tenantId, status: UserStatus.ACTIVE, deletedAt: null },
    }) : null;
    if (userPublicId && !assignedUser) throw new AppError(422, "invalid_assignee", "El agente seleccionado no está activo.");
    if (team && assignedUser) {
      const membership = await prisma.inboxTeamMember.findUnique({ where: { teamId_userId: { teamId: team.id, userId: assignedUser.id } } });
      if (!membership) throw new AppError(422, "invalid_team_member", "El agente no pertenece al equipo seleccionado.");
    }
    const assignment = await prisma.$transaction(async (transaction) => {
      await transaction.conversationAssignment.updateMany({
        where: { conversationId: conversation.id, endedAt: null },
        data: { endedAt: new Date() },
      });
      if (!assignedUser && !team) {
        await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
          action: "inbox.conversation.unassigned", entityType: "conversation", entityPublicId: conversation.publicId, ipAddress: request.ip }) });
        return null;
      }
      const created = await transaction.conversationAssignment.create({
        data: {
          tenantId: auth.tenantId,
          conversationId: conversation.id,
          assignedUserId: assignedUser?.id ?? null,
          teamId: team?.id ?? null,
          teamName: team?.name ?? null,
          assignedByUserId: auth.userId,
        },
        include: { assignedUser: { select: { publicId: true, name: true } }, team: { select: { publicId: true, name: true, color: true } } },
      });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "inbox.conversation.assigned", entityType: "conversation", entityPublicId: conversation.publicId,
        metadata: { userId: assignedUser?.publicId ?? null, teamId: team?.publicId ?? null }, ipAddress: request.ip }) });
      return created;
    });
    publishInboxEvent(auth.tenantId, { type: "assignment.updated", conversationId: conversation.publicId });
    return { assignment: assignment ? publicAssignment(assignment) : null };
  });

  app.post("/api/inbox/conversations/:conversationId/notes", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "addNotes", auth.inboxPermissions);
    const params = conversationParams.safeParse(request.params);
    const body = noteSchema.safeParse(request.body);
    if (!params.success || !body.success) throw new AppError(422, "validation_error", "La nota no es válida.");
    const conversation = await ownedConversation(auth.tenantId, params.data.conversationId);
    const note = await prisma.$transaction(async (transaction) => {
      const created = await transaction.internalNote.create({
        data: { tenantId: auth.tenantId, conversationId: conversation.id, authorUserId: auth.userId, body: body.data.body },
        include: { author: { select: { publicId: true, name: true } } },
      });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "inbox.note.created", entityType: "internal_note", entityPublicId: created.publicId,
        metadata: { conversationId: conversation.publicId }, ipAddress: request.ip }) });
      return created;
    });
    publishInboxEvent(auth.tenantId, { type: "note.created", conversationId: conversation.publicId });
    reply.status(201);
    return {
      note: {
        id: note.publicId,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
        author: { id: note.author.publicId, name: note.author.name },
      },
    };
  });

  app.patch("/api/inbox/conversations/:conversationId/contact", async (request) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "editContacts", auth.inboxPermissions);
    const params = conversationParams.safeParse(request.params);
    const body = contactSchema.safeParse(request.body);
    if (!params.success || !body.success) throw new AppError(422, "validation_error", "Los datos del contacto no son válidos.");
    const conversation = await ownedConversation(auth.tenantId, params.data.conversationId);
    const contact = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.contact.update({
        where: { id: conversation.contactId },
        data: {
          ...(body.data.name !== undefined ? { name: body.data.name || null } : {}),
          ...(body.data.email !== undefined ? { email: body.data.email || null } : {}),
          ...(body.data.company !== undefined ? { company: body.data.company || null } : {}),
          ...(body.data.notes !== undefined ? { notes: body.data.notes || null } : {}),
        },
      });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "inbox.contact.updated", entityType: "contact", entityPublicId: updated.publicId,
        metadata: { fields: Object.keys(body.data) }, ipAddress: request.ip }) });
      return updated;
    });
    publishInboxEvent(auth.tenantId, { type: "conversation.updated", conversationId: conversation.publicId });
    return { contact: { id: contact.publicId, name: contact.name, email: contact.email, company: contact.company, notes: contact.notes } };
  });

  app.post("/api/inbox/tags", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "manageTags", auth.inboxPermissions);
    const body = tagSchema.safeParse(request.body);
    if (!body.success) throw new AppError(422, "validation_error", "La etiqueta no es válida.");
    const tag = await prisma.$transaction(async (transaction) => {
      const saved = await transaction.tag.upsert({
        where: { tenantId_name: { tenantId: auth.tenantId, name: body.data.name } },
        create: { tenantId: auth.tenantId, name: body.data.name, color: body.data.color.toLowerCase() },
        update: { color: body.data.color.toLowerCase() },
      });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "inbox.tag.saved", entityType: "tag", entityPublicId: saved.publicId,
        metadata: { name: saved.name, color: saved.color }, ipAddress: request.ip }) });
      return saved;
    });
    reply.status(201);
    return { tag: { id: tag.publicId, name: tag.name, color: tag.color } };
  });

  app.post("/api/inbox/conversations/:conversationId/tags", async (request) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "manageTags", auth.inboxPermissions);
    const params = conversationParams.safeParse(request.params);
    const body = attachTagSchema.safeParse(request.body);
    if (!params.success || !body.success) throw new AppError(422, "validation_error", "Etiqueta o conversación inválidas.");
    const conversation = await ownedConversation(auth.tenantId, params.data.conversationId);
    const tag = await prisma.tag.findFirst({ where: { publicId: body.data.tagId, tenantId: auth.tenantId } });
    if (!tag) throw new AppError(404, "tag_not_found", "La etiqueta no existe.");
    await prisma.$transaction([
      prisma.conversation.update({ where: { id: conversation.id }, data: { tags: { connect: { id: tag.id } } } }),
      prisma.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "inbox.tag.attached", entityType: "conversation", entityPublicId: conversation.publicId,
        metadata: { tagId: tag.publicId }, ipAddress: request.ip }) }),
    ]);
    publishInboxEvent(auth.tenantId, { type: "tag.updated", conversationId: conversation.publicId });
    return { attached: true };
  });

  app.delete("/api/inbox/conversations/:conversationId/tags/:tagId", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "manageTags", auth.inboxPermissions);
    const params = tagParams.safeParse(request.params);
    if (!params.success) throw new AppError(422, "validation_error", "Etiqueta o conversación inválidas.");
    const conversation = await ownedConversation(auth.tenantId, params.data.conversationId);
    const tag = await prisma.tag.findFirst({ where: { publicId: params.data.tagId, tenantId: auth.tenantId } });
    if (tag) await prisma.$transaction([
      prisma.conversation.update({ where: { id: conversation.id }, data: { tags: { disconnect: { id: tag.id } } } }),
      prisma.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: "inbox.tag.detached", entityType: "conversation", entityPublicId: conversation.publicId,
        metadata: { tagId: tag.publicId }, ipAddress: request.ip }) }),
    ]);
    publishInboxEvent(auth.tenantId, { type: "tag.updated", conversationId: conversation.publicId });
    return reply.status(204).send();
  });

  app.post("/api/inbox/conversations/:conversationId/messages", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "sendMessages", auth.inboxPermissions);
    const params = conversationParams.safeParse(request.params);
    const body = sendSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      throw new AppError(422, "validation_error", "El mensaje no tiene un formato válido.", body.success ? undefined : body.error.flatten());
    }
    const conversation = await ownedConversation(auth.tenantId, params.data.conversationId);
    if (conversation.connection.status !== WhatsAppConnectionStatus.ACTIVE || conversation.connection.deletedAt) {
      throw new AppError(409, "connection_inactive", "La conexión de WhatsApp no está activa.");
    }
    const windowOpen = customerServiceWindowOpen(conversation.lastInboundAt);
    if (!windowOpen && body.data.type !== "template") {
      throw new AppError(409, "customer_service_window_closed", "La ventana de atención de 24 horas cerró. Envía una plantilla aprobada para reabrirla.");
    }
    const outbound = outboundMessageSchema.safeParse({
      ...body.data,
      to: conversation.contact.waId,
      connection_id: conversation.connection.publicId,
    });
    if (!outbound.success) throw new AppError(422, "validation_error", "El mensaje no tiene un formato válido.", outbound.error.flatten());
    const payload = metaPayload(outbound.data);
    const createdAt = new Date();
    let result;
    try {
      result = await sendMetaMessage(conversation.connection, payload, options.metaMessageFetcher);
    } catch (error) {
      const failed = await prisma.$transaction(async (transaction) => {
        const errorMessage = error instanceof Error ? error.message.slice(0, 2_000) : "Error de red con Meta.";
        const created = await persistOutboundInboxMessage(transaction, {
          conversation,
          message: outbound.data,
          payload: payload as Prisma.InputJsonValue,
          externalId: null,
          senderUserId: auth.userId,
          succeeded: false,
          errorMessage,
          createdAt,
        });
        await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
          action: "inbox.message.failed", entityType: "message", entityPublicId: created.publicId,
          metadata: { conversationId: conversation.publicId, type: body.data.type }, ipAddress: request.ip }) });
        return created;
      });
      publishInboxEvent(auth.tenantId, { type: "message.updated", conversationId: conversation.publicId });
      throw new AppError(502, "meta_unavailable", "No fue posible comunicarse con Meta.", { messageId: failed.publicId });
    }
    const externalId = Array.isArray(result.body.messages) && result.body.messages[0] &&
      typeof result.body.messages[0] === "object" && "id" in result.body.messages[0]
      ? String((result.body.messages[0] as { id: unknown }).id)
      : null;
    const message = await prisma.$transaction(async (transaction) => {
      const created = await persistOutboundInboxMessage(transaction, {
        conversation,
        message: outbound.data,
        payload: payload as Prisma.InputJsonValue,
        externalId,
        senderUserId: auth.userId,
        succeeded: result.ok,
        errorMessage: result.ok ? null : "Meta rechazó la solicitud de envío.",
        createdAt,
      });
      await transaction.webhookLog.create({
        data: {
          tenantId: auth.tenantId,
          connectionId: conversation.connectionId,
          actorUserId: auth.userId,
          direction: WebhookDirection.OUTBOUND,
          source: WebhookSource.INTERNAL,
          eventType: `inbox.message.${body.data.type}`,
          externalEventId: externalId,
          status: result.ok ? WebhookDeliveryStatus.SUCCEEDED : WebhookDeliveryStatus.FAILED,
          targetUrl: result.targetUrl,
          requestPayload: payload as Prisma.InputJsonValue,
          responsePayload: result.body as Prisma.InputJsonValue,
          httpStatus: result.status,
          attemptCount: 1,
          durationMs: result.durationMs,
          errorMessage: result.ok ? null : "Meta rechazó la solicitud de envío.",
          processedAt: createdAt,
        },
      });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: result.ok ? "inbox.message.sent" : "inbox.message.failed", entityType: "message", entityPublicId: created.publicId,
        metadata: { conversationId: conversation.publicId, type: body.data.type, externalId }, ipAddress: request.ip }) });
      return created;
    });
    publishInboxEvent(auth.tenantId, { type: "message.updated", conversationId: conversation.publicId });
    if (!result.ok) throw new AppError(502, "meta_request_failed", "Meta rechazó la solicitud de envío.", result.body);
    reply.status(201);
    return {
      message: {
        id: message.publicId,
        externalId: message.externalId,
        direction: message.direction,
        type: message.type,
        status: message.status,
        text: message.textBody,
        content: message.content,
        error: message.errorMessage,
        createdAt: message.createdAt.toISOString(),
        sentAt: date(message.sentAt),
        deliveredAt: null,
        readAt: null,
      },
    };
  });

  app.get("/api/inbox/messages/:messageId/media", async (request, reply) => {
    const auth = await requireAuth(request);
    const params = messageParams.safeParse(request.params);
    if (!params.success) throw new AppError(422, "validation_error", "Mensaje inválido.");
    const message = await prisma.message.findFirst({
      where: { publicId: params.data.messageId, tenantId: auth.tenantId, direction: MessageDirection.INBOUND },
      include: { connection: true },
    });
    if (!message) throw new AppError(404, "message_not_found", "El mensaje no existe.");
    const mediaId = inboundMediaId(message.content, message.type);
    if (!mediaId) throw new AppError(404, "media_not_found", "El mensaje no contiene un archivo descargable.");
    const media = await downloadMetaMedia(message.connection, mediaId);
    const content = object(message.content);
    const mediaContent = object(content?.[message.type.toLowerCase()]);
    const rawFilename = typeof mediaContent?.filename === "string" ? mediaContent.filename : `${message.publicId}.${media.contentType.split("/")[1]?.split(";")[0] ?? "bin"}`;
    const filename = rawFilename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180);
    reply.header("Content-Type", media.contentType);
    reply.header("Content-Disposition", `inline; filename="${filename}"`);
    reply.header("Content-Length", String(media.bytes.byteLength));
    return reply.send(Buffer.from(media.bytes));
  });

  app.post("/api/inbox/messages/:messageId/retry", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    requireInboxPermission(auth, "sendMessages", auth.inboxPermissions);
    const params = messageParams.safeParse(request.params);
    if (!params.success) throw new AppError(422, "validation_error", "Mensaje inválido.");
    const failed = await prisma.message.findFirst({
      where: { publicId: params.data.messageId, tenantId: auth.tenantId, direction: MessageDirection.OUTBOUND, status: MessageStatus.FAILED },
      include: { conversation: { include: { contact: true, connection: true } } },
    });
    if (!failed) throw new AppError(404, "failed_message_not_found", "No existe un mensaje fallido que pueda reintentarse.");
    const stored = object(failed.content);
    const type = typeof stored?.type === "string" ? stored.type : failed.type.toLowerCase();
    const candidate = {
      type,
      to: failed.conversation.contact.waId,
      connection_id: failed.conversation.connection.publicId,
      [type]: stored?.[type],
    };
    const outbound = outboundMessageSchema.safeParse(candidate);
    if (!outbound.success) throw new AppError(409, "message_not_retryable", "El contenido original ya no puede reenviarse.");
    if (outbound.data.type !== "template" && !customerServiceWindowOpen(failed.conversation.lastInboundAt)) {
      throw new AppError(409, "customer_service_window_closed", "La ventana de atención cerró; este mensaje ya no puede reintentarse.");
    }
    const payload = metaPayload(outbound.data);
    let result;
    try {
      result = await sendMetaMessage(failed.conversation.connection, payload, options.metaMessageFetcher);
    } catch (error) {
      const createdAt = new Date();
      const errorMessage = error instanceof Error ? error.message.slice(0, 2_000) : "Error de red con Meta.";
      const retry = await prisma.$transaction(async (transaction) => {
        const created = await persistOutboundInboxMessage(transaction, {
          conversation: failed.conversation, message: outbound.data, payload: payload as Prisma.InputJsonValue,
          externalId: null, senderUserId: auth.userId, succeeded: false, errorMessage, createdAt, retryOfMessageId: failed.id,
        });
        await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
          action: "inbox.message.retry_failed", entityType: "message", entityPublicId: created.publicId,
          metadata: { originalMessageId: failed.publicId, conversationId: failed.conversation.publicId }, ipAddress: request.ip }) });
        return created;
      });
      publishInboxEvent(auth.tenantId, { type: "message.updated", conversationId: failed.conversation.publicId });
      throw new AppError(502, "meta_unavailable", "No fue posible comunicarse con Meta durante el reintento.", { messageId: retry.publicId });
    }
    const externalId = Array.isArray(result.body.messages) && object(result.body.messages[0])?.id
      ? String(object(result.body.messages[0])?.id)
      : null;
    const createdAt = new Date();
    const message = await prisma.$transaction(async (transaction) => {
      const created = await persistOutboundInboxMessage(transaction, {
        conversation: failed.conversation,
        message: outbound.data,
        payload: payload as Prisma.InputJsonValue,
        externalId,
        senderUserId: auth.userId,
        succeeded: result.ok,
        errorMessage: result.ok ? null : "Meta rechazó el reintento.",
        createdAt,
        retryOfMessageId: failed.id,
      });
      await transaction.webhookLog.create({ data: {
        tenantId: auth.tenantId, connectionId: failed.connectionId, actorUserId: auth.userId,
        direction: WebhookDirection.OUTBOUND, source: WebhookSource.INTERNAL, eventType: `inbox.message.retry.${type}`,
        externalEventId: externalId, status: result.ok ? WebhookDeliveryStatus.SUCCEEDED : WebhookDeliveryStatus.FAILED,
        targetUrl: result.targetUrl, requestPayload: payload as Prisma.InputJsonValue,
        responsePayload: result.body as Prisma.InputJsonValue, httpStatus: result.status, attemptCount: 1,
        durationMs: result.durationMs, errorMessage: result.ok ? null : "Meta rechazó el reintento.", processedAt: createdAt,
      } });
      await transaction.auditLog.create({ data: inboxAuditData({ tenantId: auth.tenantId, actorUserId: auth.userId,
        action: result.ok ? "inbox.message.retried" : "inbox.message.retry_failed", entityType: "message", entityPublicId: created.publicId,
        metadata: { originalMessageId: failed.publicId, conversationId: failed.conversation.publicId }, ipAddress: request.ip }) });
      return created;
    });
    publishInboxEvent(auth.tenantId, { type: "message.updated", conversationId: failed.conversation.publicId });
    if (!result.ok) throw new AppError(502, "meta_request_failed", "Meta rechazó el reintento.", result.body);
    reply.status(201);
    return { messageId: message.publicId, conversationId: failed.conversation.publicId };
  });

  app.get("/api/inbox/events", async (request, reply) => {
    const auth = await requireAuth(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    const unsubscribe = subscribeToInbox(auth.tenantId, (event) => {
      if (!reply.raw.destroyed) reply.raw.write(`event: inbox\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n");
    }, 20_000);
    request.raw.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
