import type { FastifyRequest } from "fastify";

import { ApiKeyStatus, TenantStatus } from "../generated/prisma/enums.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createOpaqueToken, sha256 } from "../lib/security.js";

export const MESSAGE_SEND_SCOPE = "messages:send";

export interface ApiKeyAuthContext {
  apiKeyId: bigint;
  apiKeyPublicId: string;
  tenantId: bigint;
  tenantPublicId: string;
}

export function createApiKeySecret(): {
  token: string;
  keyHash: string;
  keyPrefix: string;
  lastFour: string;
} {
  const token = `thk_${createOpaqueToken()}`;
  return {
    token,
    keyHash: sha256(token),
    keyPrefix: token.slice(0, 12),
    lastFour: token.slice(-4),
  };
}

function scopesContain(value: unknown, requiredScope: string): boolean {
  return Array.isArray(value) && value.some((scope) => scope === requiredScope);
}

export async function requireApiKey(
  request: FastifyRequest,
  requiredScope: string,
): Promise<ApiKeyAuthContext> {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) throw new AppError(401, "invalid_api_key", "API Key inválida o ausente.");

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: sha256(match[1]) },
    include: { tenant: true },
  });
  const now = new Date();
  if (
    !apiKey ||
    apiKey.status !== ApiKeyStatus.ACTIVE ||
    apiKey.revokedAt ||
    (apiKey.expiresAt && apiKey.expiresAt <= now) ||
    apiKey.tenant.status !== TenantStatus.ACTIVE ||
    apiKey.tenant.deletedAt
  ) {
    throw new AppError(401, "invalid_api_key", "API Key inválida o ausente.");
  }
  if (!scopesContain(apiKey.scopes, requiredScope)) {
    throw new AppError(403, "insufficient_scope", `La API Key requiere el scope ${requiredScope}.`);
  }

  if (!apiKey.lastUsedAt || now.getTime() - apiKey.lastUsedAt.getTime() >= 60_000) {
    void prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }

  return {
    apiKeyId: apiKey.id,
    apiKeyPublicId: apiKey.publicId,
    tenantId: apiKey.tenantId,
    tenantPublicId: apiKey.tenant.publicId,
  };
}
