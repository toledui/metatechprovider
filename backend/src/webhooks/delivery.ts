import { Prisma } from "../generated/prisma/client.js";
import { WebhookDeliveryStatus } from "../generated/prisma/enums.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { decryptCredential, hmacSha256 } from "../lib/security.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
const MAX_RESPONSE_BYTES = 16 * 1024;

export type WebhookFetcher = typeof fetch;

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function limitedResponse(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_RESPONSE_BYTES) {
      const result = await reader.read();
      if (result.done) break;
      const remaining = MAX_RESPONSE_BYTES - total;
      const chunk = result.value.slice(0, remaining);
      chunks.push(chunk);
      total += chunk.byteLength;
      if (result.value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function responsePayload(response: Response, body: string): Prisma.InputJsonValue {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && body) {
    try {
      return { body: JSON.parse(body) as Prisma.InputJsonValue };
    } catch {
      // Conserva el cuerpo como texto si el destino declaró JSON inválido.
    }
  }
  return { body };
}

async function scheduleFailure(
  logId: bigint,
  connectionId: bigint | null,
  attempt: number,
  message: string,
  durationMs: number,
  httpStatus?: number,
  response?: Prisma.InputJsonValue,
) {
  const shouldRetry = attempt < env.webhookDeliveryMaxAttempts &&
    (httpStatus === undefined || retryableStatus(httpStatus));
  const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? 60 * 60_000;
  const now = new Date();

  await prisma.$transaction([
    prisma.webhookLog.update({
      where: { id: logId },
      data: {
        status: shouldRetry ? WebhookDeliveryStatus.RECEIVED : WebhookDeliveryStatus.FAILED,
        attemptCount: attempt,
        durationMs,
        httpStatus: httpStatus ?? null,
        responsePayload: response ?? Prisma.DbNull,
        errorMessage: message.slice(0, 65_535),
        nextRetryAt: shouldRetry ? new Date(now.getTime() + delay) : null,
        processedAt: shouldRetry ? null : now,
      },
    }),
    ...(connectionId && !shouldRetry
      ? [prisma.whatsAppConnection.update({ where: { id: connectionId }, data: { lastErrorAt: now } })]
      : []),
  ]);
}

export async function deliverWebhookLog(logId: bigint, fetcher: WebhookFetcher = fetch): Promise<void> {
  const log = await prisma.webhookLog.findUnique({
    where: { id: logId },
    include: { connection: true, tenant: true },
  });
  if (!log || log.status !== WebhookDeliveryStatus.PROCESSING) return;

  const attempt = log.attemptCount + 1;
  const startedAt = Date.now();
  if (!log.targetUrl || !log.connection?.webhookSecretEncrypted || !log.tenant) {
    await scheduleFailure(log.id, log.connectionId, attempt, "La entrega no tiene destino, tenant o secreto disponible.", 0, 400);
    return;
  }

  const body = JSON.stringify(log.requestPayload);
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const secret = decryptCredential(log.connection.webhookSecretEncrypted);
  const signature = hmacSha256(body, secret);

  try {
    const response = await fetcher(log.targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "THagencia-Tech-Provider-Webhooks/1.0",
        "X-THagencia-Event-Id": log.publicId,
        "X-THagencia-Event-Type": log.eventType,
        "X-THagencia-Timestamp": timestamp,
        "X-THagencia-Signature-256": `sha256=${signature}`,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(env.webhookDeliveryTimeoutMs),
    });
    const responseBody = await limitedResponse(response);
    const serializedResponse = responsePayload(response, responseBody);
    const durationMs = Date.now() - startedAt;

    if (response.ok) {
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: {
          status: WebhookDeliveryStatus.SUCCEEDED,
          attemptCount: attempt,
          httpStatus: response.status,
          responsePayload: serializedResponse,
          durationMs,
          errorMessage: null,
          nextRetryAt: null,
          processedAt: new Date(),
        },
      });
      return;
    }

    await scheduleFailure(
      log.id,
      log.connectionId,
      attempt,
      `El webhook destino respondió HTTP ${response.status}.`,
      durationMs,
      response.status,
      serializedResponse,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await scheduleFailure(log.id, log.connectionId, attempt, `Error de red: ${message}`, Date.now() - startedAt);
  }
}

export async function claimNextWebhookLog(): Promise<bigint | null> {
  const candidate = await prisma.webhookLog.findFirst({
    where: {
      status: WebhookDeliveryStatus.RECEIVED,
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: { receivedAt: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await prisma.webhookLog.updateMany({
    where: { id: candidate.id, status: WebhookDeliveryStatus.RECEIVED },
    data: { status: WebhookDeliveryStatus.PROCESSING, processedAt: new Date() },
  });
  return claimed.count === 1 ? candidate.id : null;
}

export async function recoverStaleWebhookLogs(): Promise<number> {
  const recovered = await prisma.webhookLog.updateMany({
    where: {
      status: WebhookDeliveryStatus.PROCESSING,
      processedAt: { lt: new Date(Date.now() - 5 * 60_000) },
    },
    data: {
      status: WebhookDeliveryStatus.RECEIVED,
      processedAt: null,
      nextRetryAt: new Date(),
      errorMessage: "Entrega recuperada después de una interrupción del worker.",
    },
  });
  return recovered.count;
}
