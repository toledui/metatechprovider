import { UserTokenType } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { createOpaqueToken, sha256 } from "../lib/security.js";

const TOKEN_REQUEST_COOLDOWN_MS = 60_000;

export const userTokenTtl = Object.freeze({
  emailVerificationMs: 24 * 60 * 60 * 1_000,
  passwordResetMs: 60 * 60 * 1_000,
});

export async function hasRecentToken(userId: bigint, type: UserTokenType): Promise<boolean> {
  const recent = await prisma.userToken.findFirst({
    where: {
      userId,
      type,
      createdAt: { gt: new Date(Date.now() - TOKEN_REQUEST_COOLDOWN_MS) },
    },
    select: { id: true },
  });

  return recent !== null;
}

export async function issueUserToken(
  userId: bigint,
  type: UserTokenType,
  ttlMs: number,
  requestIp: string,
): Promise<string> {
  const token = createOpaqueToken();
  const now = new Date();

  await prisma.$transaction([
    prisma.userToken.updateMany({
      where: { userId, type, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.userToken.create({
      data: {
        userId,
        type,
        tokenHash: sha256(token),
        expiresAt: new Date(now.getTime() + ttlMs),
        requestIp: requestIp.slice(0, 64),
      },
    }),
  ]);

  return token;
}

export async function findUsableToken(token: string, type: UserTokenType) {
  return prisma.userToken.findFirst({
    where: {
      tokenHash: sha256(token),
      type,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: { include: { tenant: true } } },
  });
}
