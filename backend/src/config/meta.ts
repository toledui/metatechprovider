import { env } from "./env.js";

export const metaConfig = Object.freeze({
  graphApiVersion: env.metaGraphApiVersion,
  graphApiBaseUrl: env.metaGraphApiBaseUrl,
  graphApiVersionedBaseUrl: `${env.metaGraphApiBaseUrl}/${env.metaGraphApiVersion}`,
  appId: env.metaAppId,
  appSecret: env.metaAppSecret,
  configId: env.metaConfigId,
});

export function metaGraphUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");

  return `${metaConfig.graphApiVersionedBaseUrl}/${normalizedPath}`;
}
