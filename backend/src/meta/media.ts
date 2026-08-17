import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { decryptCredential } from "../lib/security.js";

const MAX_MEDIA_BYTES = 30 * 1024 * 1024;

interface MetaMediaConnection {
  accessTokenEncrypted: string;
}

interface MediaMetadata {
  url?: string;
  mime_type?: string;
  file_size?: number;
  id?: string;
  error?: { message?: string };
}

export async function downloadMetaMedia(
  connection: MetaMediaConnection,
  mediaId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const token = decryptCredential(connection.accessTokenEncrypted);
  const headers = { Authorization: `Bearer ${token}` };
  const metadataResponse = await fetcher(
    `${env.metaGraphApiBaseUrl}/${env.metaGraphApiVersion}/${encodeURIComponent(mediaId)}`,
    { headers, signal: AbortSignal.timeout(env.metaMessageTimeoutMs) },
  ).catch((error: unknown) => {
    throw new AppError(502, "meta_unavailable", "No fue posible consultar el archivo en Meta.", error instanceof Error ? error.message : undefined);
  });
  const metadata = await metadataResponse.json().catch(() => ({})) as MediaMetadata;
  if (!metadataResponse.ok || !metadata.url) {
    throw new AppError(502, "meta_media_error", metadata.error?.message ?? "Meta no devolvió una URL válida para el archivo.");
  }
  if (metadata.file_size && metadata.file_size > MAX_MEDIA_BYTES) {
    throw new AppError(413, "media_too_large", "El archivo supera el límite de descarga de 30 MB.");
  }
  const response = await fetcher(metadata.url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(env.metaMessageTimeoutMs),
  }).catch((error: unknown) => {
    throw new AppError(502, "meta_unavailable", "No fue posible descargar el archivo desde Meta.", error instanceof Error ? error.message : undefined);
  });
  if (!response.ok) throw new AppError(502, "meta_media_download_failed", "Meta rechazó la descarga del archivo.");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_MEDIA_BYTES) {
    throw new AppError(413, "media_too_large", "El archivo supera el límite de descarga de 30 MB.");
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_MEDIA_BYTES) throw new AppError(413, "media_too_large", "El archivo supera el límite de descarga de 30 MB.");
  return {
    bytes: buffer,
    contentType: response.headers.get("content-type") ?? metadata.mime_type ?? "application/octet-stream",
  };
}
