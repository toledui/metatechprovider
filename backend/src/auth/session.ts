import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../config/env.js";
import { UserStatus } from "../generated/prisma/enums.js";
import { PlatformRole } from "../generated/prisma/enums.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createOpaqueToken, sha256 } from "../lib/security.js";

const SESSION_COOKIE = "thagencia_session";
const SESSION_MAX_AGE_SECONDS = env.sessionTtlDays * 24 * 60 * 60;

export interface AuthContext {
  sessionId: bigint;
  userId: bigint;
  userPublicId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  platformRole: string;
  tenantId: bigint;
  tenantPublicId: string;
  tenantName: string;
  tenantSlug: string;
}

function cookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function createSession(
  reply: FastifyReply,
  userId: bigint,
  request: FastifyRequest,
): Promise<void> {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1_000);

  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
      ipAddress: request.ip.slice(0, 64),
    },
  });

  reply.setCookie(SESSION_COOKIE, token, cookieOptions());
}

export async function requireAuth(request: FastifyRequest): Promise<AuthContext> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) throw new AppError(401, "unauthorized", "Inicia sesión para continuar.");

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { tenant: true } } },
  });

  const now = new Date();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.user.status !== UserStatus.ACTIVE ||
    session.user.deletedAt ||
    session.user.tenant.deletedAt
  ) {
    throw new AppError(401, "unauthorized", "La sesión expiró o ya no es válida.");
  }

  if (now.getTime() - session.lastUsedAt.getTime() > 5 * 60 * 1_000) {
    void prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    }).catch(() => undefined);
  }

  return {
    sessionId: session.id,
    userId: session.user.id,
    userPublicId: session.user.publicId,
    userName: session.user.name,
    userEmail: session.user.email,
    userRole: session.user.role,
    platformRole: session.user.platformRole,
    tenantId: session.user.tenant.id,
    tenantPublicId: session.user.tenant.publicId,
    tenantName: session.user.tenant.name,
    tenantSlug: session.user.tenant.slug,
  };
}

export async function requireSuperAdmin(request: FastifyRequest): Promise<AuthContext> {
  const auth = await requireAuth(request);
  if (auth.platformRole !== PlatformRole.SUPERADMIN) {
    throw new AppError(403, "superadmin_required", "No tienes acceso al panel global.");
  }

  return auth;
}

export async function revokeCurrentSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function assertSameOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin?.replace(/\/$/, "");
  const developmentOriginAllowed = env.nodeEnv !== "production" && origin &&
    env.devAllowedOrigins.includes(origin);
  if (origin && origin !== env.appOrigin && !developmentOriginAllowed) {
    throw new AppError(403, "invalid_origin", "El origen de la solicitud no está permitido.");
  }
}
