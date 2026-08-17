import { createHash } from "node:crypto";
import { z } from "zod";

import { Prisma } from "../generated/prisma/client.js";
import {
  TenantStatus,
  WebhookDeliveryStatus,
  WebhookDirection,
  WebhookSource,
  WhatsAppConnectionStatus,
} from "../generated/prisma/enums.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { processMetaInboxValue } from "../inbox/meta-events.js";

const changeSchema = z.object({
  field: z.string().min(1).max(100),
  value: z.record(z.string(), z.unknown()),
});

const payloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    id: z.string().min(1).max(191),
    time: z.number().optional(),
    changes: z.array(changeSchema).max(100),
  })).max(100),
});

interface PendingChange {
  phoneNumberId: string | null;
  eventType: string;
  externalEventId: string | null;
  deduplicationKey: string;
  payload: Prisma.InputJsonValue;
  inboxValue: Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? objectValue(value[0]) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function describeChange(field: string, value: Record<string, unknown>) {
  const message = firstRecord(value.messages);
  if (message) {
    return {
      eventType: `message.${stringValue(message.type) ?? "unknown"}`,
      externalEventId: stringValue(message.id),
    };
  }

  const status = firstRecord(value.statuses);
  if (status) {
    return {
      eventType: `status.${stringValue(status.status) ?? "unknown"}`,
      externalEventId: stringValue(status.id),
    };
  }

  if (Array.isArray(value.errors) && value.errors.length > 0) {
    return { eventType: "messages.error", externalEventId: null };
  }

  return { eventType: field, externalEventId: null };
}

function phoneNumberId(value: Record<string, unknown>): string | null {
  return stringValue(objectValue(value.metadata)?.phone_number_id);
}

function deduplicationKey(rawBody: Buffer, entryIndex: number, changeIndex: number): string {
  return createHash("sha256")
    .update(rawBody)
    .update(`:${entryIndex}:${changeIndex}`)
    .digest("hex");
}

export async function ingestMetaWebhook(payload: unknown, rawBody: Buffer) {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(400, "invalid_meta_webhook", "El payload de Meta no tiene el formato esperado.");
  }

  const changes: PendingChange[] = parsed.data.entry.flatMap((entry, entryIndex) =>
    entry.changes.map((change, changeIndex) => {
      const description = describeChange(change.field, change.value);
      return {
        phoneNumberId: phoneNumberId(change.value),
        eventType: description.eventType,
        externalEventId: description.externalEventId,
        deduplicationKey: deduplicationKey(rawBody, entryIndex, changeIndex),
        inboxValue: change.value,
        payload: {
          object: parsed.data.object,
          entry: [{
            id: entry.id,
            ...(entry.time === undefined ? {} : { time: entry.time }),
            changes: [change],
          }],
        } as Prisma.InputJsonValue,
      };
    }),
  );

  if (changes.length === 0) return { accepted: 0, duplicates: 0 };

  const phoneIds = [...new Set(changes.flatMap((change) => change.phoneNumberId ? [change.phoneNumberId] : []))];
  const connections = await prisma.whatsAppConnection.findMany({
    where: { phoneNumberId: { in: phoneIds }, deletedAt: null },
    include: { tenant: true },
  });
  const byPhone = new Map(connections.map((connection) => [connection.phoneNumberId, connection]));

  const rows: Prisma.WebhookLogCreateManyInput[] = changes.map((change) => {
    const connection = change.phoneNumberId ? byPhone.get(change.phoneNumberId) : undefined;
    const deliverable = Boolean(
      connection &&
      connection.status === WhatsAppConnectionStatus.ACTIVE &&
      connection.tenant.status === TenantStatus.ACTIVE &&
      !connection.tenant.deletedAt &&
      connection.webhookUrl &&
      connection.webhookSecretEncrypted,
    );
    const ignoredReason = !change.phoneNumberId
      ? "El evento no contiene metadata.phone_number_id."
      : !connection
        ? "No existe una conexión para el phone_number_id recibido."
        : connection.tenant.status !== TenantStatus.ACTIVE
          ? "El tenant no se encuentra activo."
          : connection.status !== WhatsAppConnectionStatus.ACTIVE
            ? "La conexión de WhatsApp no se encuentra activa."
            : !connection.webhookUrl || !connection.webhookSecretEncrypted
              ? "El tenant todavía no configuró un webhook destino."
              : null;

    return {
      tenantId: connection?.tenantId ?? null,
      connectionId: connection?.id ?? null,
      direction: WebhookDirection.INBOUND,
      source: WebhookSource.META,
      eventType: change.eventType,
      externalEventId: change.externalEventId,
      deduplicationKey: change.deduplicationKey,
      status: deliverable ? WebhookDeliveryStatus.RECEIVED : WebhookDeliveryStatus.IGNORED,
      targetUrl: deliverable && connection ? connection.webhookUrl : null,
      requestPayload: change.payload,
      errorMessage: ignoredReason,
    };
  });

  const created = await prisma.webhookLog.createMany({ data: rows, skipDuplicates: true });
  for (const change of changes) {
    const connection = change.phoneNumberId ? byPhone.get(change.phoneNumberId) : undefined;
    if (
      connection &&
      connection.status === WhatsAppConnectionStatus.ACTIVE &&
      connection.tenant.status === TenantStatus.ACTIVE &&
      !connection.tenant.deletedAt
    ) {
      await processMetaInboxValue(connection, change.inboxValue);
    }
  }
  if (connections.length > 0) {
    await prisma.whatsAppConnection.updateMany({
      where: { id: { in: connections.map((connection) => connection.id) } },
      data: { lastWebhookAt: new Date() },
    });
  }

  return { accepted: created.count, duplicates: rows.length - created.count };
}
