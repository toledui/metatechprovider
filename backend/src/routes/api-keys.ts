import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createApiKeySecret, MESSAGE_SEND_SCOPE } from "../api-keys/service.js";
import { assertSameOrigin, requireAuth } from "../auth/session.js";
import { ApiKeyStatus, UserRole } from "../generated/prisma/enums.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const createSchema = z.object({
  name: z.string().trim().min(3).max(100),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const paramsSchema = z.object({ apiKeyId: z.string().min(1).max(30) });

function assertCanManageApiKeys(role: string): void {
  if (role !== UserRole.OWNER && role !== UserRole.ADMIN) {
    throw new AppError(403, "api_key_admin_required", "Solo un owner o admin puede administrar API Keys.");
  }
}

function publicApiKey(apiKey: {
  publicId: string;
  name: string;
  keyPrefix: string;
  lastFour: string;
  scopes: unknown;
  status: ApiKeyStatus;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: apiKey.publicId,
    name: apiKey.name,
    maskedKey: `${apiKey.keyPrefix}••••••••${apiKey.lastFour}`,
    scopes: apiKey.scopes,
    status: apiKey.status,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    revokedAt: apiKey.revokedAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
  };
}

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/api-keys", async (request) => {
    const auth = await requireAuth(request);
    const apiKeys = await prisma.apiKey.findMany({
      where: { tenantId: auth.tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { apiKeys: apiKeys.map(publicApiKey) };
  });

  app.post("/api/api-keys", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    assertCanManageApiKeys(auth.userRole);
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "validation_error", "Los datos de la API Key no son válidos.", parsed.error.flatten());

    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now() + 60_000) {
      throw new AppError(422, "invalid_expiration", "La expiración debe estar en el futuro.");
    }
    const secret = createApiKeySecret();
    const apiKey = await prisma.apiKey.create({
      data: {
        tenantId: auth.tenantId,
        createdByUserId: auth.userId,
        name: parsed.data.name,
        keyPrefix: secret.keyPrefix,
        keyHash: secret.keyHash,
        lastFour: secret.lastFour,
        scopes: [MESSAGE_SEND_SCOPE],
        expiresAt,
      },
    });

    reply.status(201);
    return { apiKey: publicApiKey(apiKey), token: secret.token };
  });

  app.delete("/api/api-keys/:apiKeyId", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    assertCanManageApiKeys(auth.userRole);
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) throw new AppError(422, "validation_error", "API Key inválida.");

    const apiKey = await prisma.apiKey.findFirst({
      where: { publicId: params.data.apiKeyId, tenantId: auth.tenantId },
    });
    if (!apiKey) throw new AppError(404, "api_key_not_found", "API Key no encontrada.");
    if (apiKey.status === ApiKeyStatus.ACTIVE) {
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
      });
    }
    return reply.status(204).send();
  });
}
