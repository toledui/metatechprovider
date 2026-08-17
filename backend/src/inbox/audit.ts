import type { Prisma } from "../generated/prisma/client.js";

export function inboxAuditData(input: {
  tenantId: bigint;
  actorUserId: bigint;
  action: string;
  entityType: string;
  entityPublicId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
}) {
  return {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityPublicId: input.entityPublicId ?? null,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ipAddress: input.ipAddress?.slice(0, 64) ?? null,
  };
}
