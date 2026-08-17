import { Prisma } from "../generated/prisma/client.js";
import {
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
} from "../generated/prisma/enums.js";
import type { OutboundMessageInput } from "../gateway/message-schema.js";
import { prisma } from "../lib/prisma.js";

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface OutboundConversation {
  id: bigint;
  publicId: string;
  tenantId: bigint;
  contactId: bigint;
  connectionId: bigint;
  lastInboundAt: Date | null;
}

export function customerServiceWindowOpen(lastInboundAt: Date | null, now = new Date()): boolean {
  return Boolean(lastInboundAt && lastInboundAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS > now.getTime());
}

export async function findOutboundConversation(
  tenantId: bigint,
  connectionId: bigint,
  waId: string,
): Promise<OutboundConversation | null> {
  return prisma.conversation.findFirst({
    where: { tenantId, connectionId, contact: { waId } },
    select: {
      id: true,
      publicId: true,
      tenantId: true,
      contactId: true,
      connectionId: true,
      lastInboundAt: true,
    },
  });
}

export async function ensureOutboundConversation(
  tenantId: bigint,
  connectionId: bigint,
  waId: string,
): Promise<OutboundConversation> {
  return prisma.$transaction(async (transaction) => {
    const contact = await transaction.contact.upsert({
      where: { tenantId_waId: { tenantId, waId } },
      create: { tenantId, waId, name: waId },
      update: {},
    });
    return transaction.conversation.upsert({
      where: { contactId_connectionId: { contactId: contact.id, connectionId } },
      create: {
        tenantId,
        contactId: contact.id,
        connectionId,
        status: ConversationStatus.OPEN,
      },
      update: {},
      select: {
        id: true,
        publicId: true,
        tenantId: true,
        contactId: true,
        connectionId: true,
        lastInboundAt: true,
      },
    });
  });
}

function messageType(message: OutboundMessageInput): MessageType {
  return message.type.toUpperCase() as MessageType;
}

function messageText(message: OutboundMessageInput): string | null {
  if (message.type === "text") return message.text.body;
  if (message.type === "template") return message.template.name;
  if (message.type === "image") return message.image.caption ?? null;
  if (message.type === "video") return message.video.caption ?? null;
  if (message.type === "document") return message.document.caption ?? message.document.filename ?? null;
  return null;
}

function messagePreview(message: OutboundMessageInput): string {
  if (message.type === "text") return message.text.body.slice(0, 500);
  if (message.type === "template") return `Plantilla · ${message.template.name}`;
  if (message.type === "image") return message.image.caption?.slice(0, 500) ?? "Imagen";
  if (message.type === "video") return message.video.caption?.slice(0, 500) ?? "Video";
  if (message.type === "document") {
    return message.document.caption?.slice(0, 500) ?? message.document.filename ?? "Documento";
  }
  return "Audio";
}

export async function persistOutboundInboxMessage(
  transaction: Prisma.TransactionClient,
  input: {
    conversation: OutboundConversation;
    message: OutboundMessageInput;
    payload: Prisma.InputJsonValue;
    externalId: string | null;
    senderUserId: bigint | null;
    succeeded: boolean;
    errorMessage: string | null;
    createdAt: Date;
    retryOfMessageId?: bigint | null;
  },
) {
  const created = await transaction.message.create({
    data: {
      tenantId: input.conversation.tenantId,
      conversationId: input.conversation.id,
      connectionId: input.conversation.connectionId,
      senderUserId: input.senderUserId,
      externalId: input.externalId,
      direction: MessageDirection.OUTBOUND,
      type: messageType(input.message),
      status: input.succeeded ? MessageStatus.SENT : MessageStatus.FAILED,
      textBody: messageText(input.message),
      content: input.payload,
      errorMessage: input.errorMessage,
      sentAt: input.succeeded ? input.createdAt : null,
      failedAt: input.succeeded ? null : input.createdAt,
      createdAt: input.createdAt,
      retryOfMessageId: input.retryOfMessageId ?? null,
    },
  });
  await transaction.conversation.update({
    where: { id: input.conversation.id },
    data: {
      lastMessageAt: input.createdAt,
      lastOutboundAt: input.createdAt,
      lastMessagePreview: messagePreview(input.message),
    },
  });
  return created;
}
