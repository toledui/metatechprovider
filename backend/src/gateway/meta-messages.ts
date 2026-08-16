import { env } from "../config/env.js";
import { decryptCredential } from "../lib/security.js";

export type MetaMessageFetcher = typeof fetch;

export interface MetaMessageConnection {
  phoneNumberId: string;
  accessTokenEncrypted: string;
}

export interface MetaMessageResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  durationMs: number;
  targetUrl: string;
}

export async function sendMetaMessage(
  connection: MetaMessageConnection,
  payload: Record<string, unknown>,
  fetcher: MetaMessageFetcher = fetch,
): Promise<MetaMessageResult> {
  const targetUrl = `${env.metaGraphApiBaseUrl}/${env.metaGraphApiVersion}/${encodeURIComponent(connection.phoneNumberId)}/messages`;
  const startedAt = Date.now();
  const response = await fetcher(targetUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${decryptCredential(connection.accessTokenEncrypted)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(env.metaMessageTimeoutMs),
  });
  const raw = await response.text();
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { response: parsed };
  } catch {
    body = { response: raw.slice(0, 4_096) };
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
    durationMs: Date.now() - startedAt,
    targetUrl,
  };
}
