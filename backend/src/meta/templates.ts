import { env } from "../config/env.js";
import type { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import { decryptCredential } from "../lib/security.js";

export type MetaTemplateFetcher = typeof fetch;

export interface MetaTemplateConnection {
  wabaId: string;
  accessTokenEncrypted: string;
}

export interface MetaTemplateRecord {
  id?: string;
  name: string;
  language: string;
  category: string;
  status: string;
  quality_score?: string | { score?: string };
  rejected_reason?: string;
  components: Prisma.InputJsonValue;
  [key: string]: unknown;
}

interface MetaListResponse {
  data?: MetaTemplateRecord[];
  paging?: { next?: string };
  error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

async function request<T>(
  connection: MetaTemplateConnection,
  url: string,
  init: RequestInit,
  fetcher: MetaTemplateFetcher,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${decryptCredential(connection.accessTokenEncrypted)}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(env.metaMessageTimeoutMs),
    });
  } catch (error) {
    throw new AppError(502, "meta_unavailable", "No fue posible conectar con Meta para administrar plantillas.", error instanceof Error ? error.message : undefined);
  }
  const payload = await response.json().catch(() => ({})) as T & MetaListResponse;
  if (!response.ok || payload.error) {
    throw new AppError(502, "meta_template_error", payload.error?.message ?? "Meta rechazó la operación de plantilla.", {
      status: response.status,
      code: payload.error?.code,
      subcode: payload.error?.error_subcode,
      traceId: payload.error?.fbtrace_id,
    });
  }
  return payload;
}

function graphUrl(path: string): string {
  return `${env.metaGraphApiBaseUrl}/${env.metaGraphApiVersion}/${path}`;
}

export async function listMetaTemplates(
  connection: MetaTemplateConnection,
  fetcher: MetaTemplateFetcher = fetch,
): Promise<MetaTemplateRecord[]> {
  const fields = "id,name,language,status,category,components,quality_score,rejected_reason";
  let next: string | undefined = `${graphUrl(`${encodeURIComponent(connection.wabaId)}/message_templates`)}?limit=100&fields=${encodeURIComponent(fields)}`;
  const templates: MetaTemplateRecord[] = [];
  for (let page = 0; next && page < 20; page += 1) {
    const payload: MetaListResponse = await request<MetaListResponse>(connection, next, { method: "GET" }, fetcher);
    templates.push(...(payload.data ?? []));
    next = payload.paging?.next;
  }
  return templates;
}

export async function createMetaTemplate(
  connection: MetaTemplateConnection,
  body: Record<string, unknown>,
  fetcher: MetaTemplateFetcher = fetch,
): Promise<Record<string, unknown>> {
  return request(connection, graphUrl(`${encodeURIComponent(connection.wabaId)}/message_templates`), {
    method: "POST",
    body: JSON.stringify(body),
  }, fetcher);
}

export async function updateMetaTemplate(
  connection: MetaTemplateConnection,
  templateId: string,
  body: Record<string, unknown>,
  fetcher: MetaTemplateFetcher = fetch,
): Promise<Record<string, unknown>> {
  return request(connection, graphUrl(encodeURIComponent(templateId)), {
    method: "POST",
    body: JSON.stringify(body),
  }, fetcher);
}

export async function deleteMetaTemplate(
  connection: MetaTemplateConnection,
  name: string,
  fetcher: MetaTemplateFetcher = fetch,
): Promise<Record<string, unknown>> {
  const url = new URL(graphUrl(`${encodeURIComponent(connection.wabaId)}/message_templates`));
  url.searchParams.set("name", name);
  return request(connection, url.toString(), { method: "DELETE" }, fetcher);
}
