import { Prisma } from "../generated/prisma/client.js";
import {
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
} from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { publishInboxEvent } from "./realtime.js";

interface InboxConnection {
  id: bigint;
  tenantId: bigint;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function eventDate(value: unknown): Date {
  const seconds = Number(value);
  const date = Number.isFinite(seconds) ? new Date(seconds * 1_000) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function messageType(value: unknown): MessageType {
  const normalized = string(value)?.toUpperCase();
  return normalized && Object.values(MessageType).includes(normalized as MessageType)
    ? normalized as MessageType
    : MessageType.UNKNOWN;
}

function messageText(message: Record<string, unknown>, type: MessageType): string | null {
  const content = record(message[String(message.type ?? "")]);
  if (type === MessageType.TEXT) return string(record(message.text)?.body);
  if (type === MessageType.INTERACTIVE) {
    const interactive = record(message.interactive);
    return string(record(interactive?.button_reply)?.title) ?? string(record(interactive?.list_reply)?.title);
  }
  if (type === MessageType.REACTION) return string(record(message.reaction)?.emoji);
  if (type === MessageType.LOCATION) {
    const location = record(message.location);
    return string(location?.name) ?? string(location?.address) ?? "Ubicación compartida";
  }
  if (type === MessageType.CONTACTS) return "Contacto compartido";
  return string(content?.caption) ?? string(content?.filename) ?? null;
}

function preview(type: MessageType, textBody: string | null): string {
  if (textBody) return textBody.slice(0, 500);
  const labels: Record<MessageType, string> = {
    TEXT: "Mensaje de texto",
    TEMPLATE: "Plantilla",
    IMAGE: "Imagen",
    DOCUMENT: "Documento",
    AUDIO: "Audio",
    VIDEO: "Video",
    STICKER: "Sticker",
    INTERACTIVE: "Mensaje interactivo",
    LOCATION: "Ubicación",
    CONTACTS: "Contacto",
    REACTION: "Reacción",
    UNKNOWN: "Mensaje no compatible",
  };
  return labels[type];
}

async function processIncomingMessage(
  connection: InboxConnection,
  value: Record<string, unknown>,
  message: Record<string, unknown>,
): Promise<string | null> {
  const externalId = string(message.id);
  const waId = string(message.from);
  if (!externalId || !waId) return null;
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const metaContact = contacts.map(record).find((contact) => string(contact?.wa_id) === waId) ?? null;
  const profileName = string(record(metaContact?.profile)?.name);
  const type = messageType(message.type);
  const textBody = messageText(message, type);
  const occurredAt = eventDate(message.timestamp);

  try {
    const conversationPublicId = await prisma.$transaction(async (transaction) => {
      const contact = await transaction.contact.upsert({
        where: { tenantId_waId: { tenantId: connection.tenantId, waId } },
        create: {
          tenantId: connection.tenantId,
          waId,
          name: profileName,
          profileName,
          ...(metaContact ? { metadata: metaContact as Prisma.InputJsonValue } : {}),
        },
        update: {
          ...(profileName ? { profileName } : {}),
          ...(metaContact ? { metadata: metaContact as Prisma.InputJsonValue } : {}),
        },
      });
      const conversation = await transaction.conversation.upsert({
        where: { contactId_connectionId: { contactId: contact.id, connectionId: connection.id } },
        create: {
          tenantId: connection.tenantId,
          contactId: contact.id,
          connectionId: connection.id,
          status: ConversationStatus.OPEN,
        },
        update: {},
      });
      await transaction.message.create({
        data: {
          tenantId: connection.tenantId,
          conversationId: conversation.id,
          connectionId: connection.id,
          externalId,
          direction: MessageDirection.INBOUND,
          type,
          status: MessageStatus.RECEIVED,
          textBody,
          content: message as Prisma.InputJsonValue,
          createdAt: occurredAt,
        },
      });
      await transaction.conversation.update({
        where: { id: conversation.id },
        data: {
          status: conversation.status === ConversationStatus.RESOLVED ? ConversationStatus.OPEN : conversation.status,
          resolvedAt: conversation.status === ConversationStatus.RESOLVED ? null : conversation.resolvedAt,
          lastMessageAt: !conversation.lastMessageAt || occurredAt > conversation.lastMessageAt ? occurredAt : conversation.lastMessageAt,
          lastInboundAt: !conversation.lastInboundAt || occurredAt > conversation.lastInboundAt ? occurredAt : conversation.lastInboundAt,
          lastMessagePreview: !conversation.lastMessageAt || occurredAt >= conversation.lastMessageAt
            ? preview(type, textBody)
            : conversation.lastMessagePreview,
          unreadCount: { increment: 1 },
        },
      });
      return conversation.publicId;
    });
    return conversationPublicId;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return null;
    throw error;
  }
}

const statusRank: Record<MessageStatus, number> = {
  RECEIVED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

async function processMessageStatus(
  connection: InboxConnection,
  status: Record<string, unknown>,
): Promise<string | null> {
  const externalId = string(status.id);
  const normalized = string(status.status)?.toUpperCase();
  if (!externalId || !normalized || !Object.values(MessageStatus).includes(normalized as MessageStatus)) return null;
  const nextStatus = normalized as MessageStatus;
  const message = await prisma.message.findFirst({
    where: { externalId, tenantId: connection.tenantId, connectionId: connection.id },
    include: { conversation: { select: { publicId: true } } },
  });
  if (!message || (nextStatus !== MessageStatus.FAILED && statusRank[nextStatus] < statusRank[message.status])) return null;
  const occurredAt = eventDate(status.timestamp);
  const errors = Array.isArray(status.errors) ? status.errors.map(record).filter(Boolean) as Record<string, unknown>[] : [];
  const error = errors[0];
  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: nextStatus,
      ...(nextStatus === MessageStatus.SENT ? { sentAt: occurredAt } : {}),
      ...(nextStatus === MessageStatus.DELIVERED ? { deliveredAt: occurredAt } : {}),
      ...(nextStatus === MessageStatus.READ ? { readAt: occurredAt } : {}),
      ...(nextStatus === MessageStatus.FAILED ? {
        failedAt: occurredAt,
        errorCode: error?.code === undefined ? null : String(error.code).slice(0, 100),
        errorMessage: string(error?.message) ?? string(error?.title) ?? string(record(error?.error_data)?.details),
      } : {}),
    },
  });
  return message.conversation.publicId;
}

export async function processMetaInboxValue(
  connection: InboxConnection,
  value: Record<string, unknown>,
): Promise<number> {
  const changedConversations = new Set<string>();
  const messages = Array.isArray(value.messages) ? value.messages.map(record).filter(Boolean) as Record<string, unknown>[] : [];
  const statuses = Array.isArray(value.statuses) ? value.statuses.map(record).filter(Boolean) as Record<string, unknown>[] : [];
  for (const message of messages) {
    const conversationId = await processIncomingMessage(connection, value, message);
    if (conversationId) changedConversations.add(conversationId);
  }
  for (const status of statuses) {
    const conversationId = await processMessageStatus(connection, status);
    if (conversationId) changedConversations.add(conversationId);
  }
  for (const conversationId of changedConversations) {
    publishInboxEvent(connection.tenantId, { type: "message.updated", conversationId });
  }
  return changedConversations.size;
}
