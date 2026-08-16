import { Prisma } from "../generated/prisma/client.js";
import { DataDeletionStatus, WhatsAppConnectionStatus } from "../generated/prisma/enums.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { createOpaqueToken, encryptCredential, hmacSha256, sha256 } from "../lib/security.js";

export interface DataDeletionResult {
  confirmationCode: string;
  statusUrl: string;
  status: DataDeletionStatus;
}

export async function deauthorizeMetaUser(metaUserId: string): Promise<number> {
  const disconnected = await prisma.whatsAppConnection.updateMany({
    where: { metaUserId, deletedAt: null },
    data: {
      status: WhatsAppConnectionStatus.DISCONNECTED,
      accessTokenEncrypted: encryptCredential(createOpaqueToken()),
      tokenExpiresAt: null,
      webhookUrl: null,
      webhookSecretEncrypted: null,
      lastErrorAt: new Date(),
    },
  });
  return disconnected.count;
}

async function purgeMetaUserData(requestId: bigint, metaUserId: string): Promise<number> {
  const connections = await prisma.whatsAppConnection.findMany({
    where: { metaUserId },
    select: { id: true, publicId: true, tenantId: true },
  });
  const connectionIds = connections.map((connection) => connection.id);
  const tenantIds = [...new Set(connections.map((connection) => connection.tenantId))];
  const now = new Date();

  await prisma.$transaction([
    ...(connectionIds.length > 0
      ? [prisma.webhookLog.deleteMany({ where: { connectionId: { in: connectionIds } } })]
      : []),
    ...connections.map((connection) => prisma.whatsAppConnection.update({
      where: { id: connection.id },
      data: {
        wabaId: `deleted_${connection.publicId}`,
        phoneNumberId: `deleted_${connection.publicId}`,
        displayPhoneNumber: null,
        verifiedName: null,
        accessTokenEncrypted: encryptCredential(createOpaqueToken()),
        tokenExpiresAt: null,
        status: WhatsAppConnectionStatus.DISCONNECTED,
        webhookUrl: null,
        webhookSecretEncrypted: null,
        coexistenceEnabled: false,
        metaBusinessId: null,
        metaUserId: null,
        metadata: Prisma.DbNull,
        connectedAt: null,
        lastWebhookAt: null,
        lastErrorAt: null,
        deletedAt: now,
      },
    })),
    prisma.dataDeletionRequest.update({
      where: { id: requestId },
      data: {
        tenant: tenantIds.length === 1
          ? { connect: { id: tenantIds[0]! } }
          : { disconnect: true },
        status: DataDeletionStatus.COMPLETED,
        affectedConnections: connections.length,
        completedAt: now,
        errorMessage: null,
      },
    }),
  ]);

  return connections.length;
}

export async function processDataDeletion(
  signedRequest: string,
  metaUserId: string,
  appSecret: string,
): Promise<DataDeletionResult> {
  const requestHash = sha256(signedRequest);
  const confirmationCode = hmacSha256(`data-deletion:${signedRequest}`, appSecret).slice(0, 40);
  const confirmationCodeHash = sha256(confirmationCode);
  let request = await prisma.dataDeletionRequest.findUnique({ where: { requestHash } });

  if (!request) {
    request = await prisma.dataDeletionRequest.create({
      data: {
        requestHash,
        confirmationCodeHash,
        metaUserIdHash: sha256(metaUserId),
      },
    });
  }

  if (request.status !== DataDeletionStatus.COMPLETED) {
    try {
      await purgeMetaUserData(request.id, metaUserId);
      request = await prisma.dataDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
    } catch (error) {
      await prisma.dataDeletionRequest.update({
        where: { id: request.id },
        data: {
          status: DataDeletionStatus.FAILED,
          errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 65_535),
        },
      });
      throw error;
    }
  }

  return {
    confirmationCode,
    statusUrl: `${env.appOrigin}/data-deletion?code=${encodeURIComponent(confirmationCode)}`,
    status: request.status,
  };
}

export async function getDataDeletionStatus(confirmationCode: string) {
  const request = await prisma.dataDeletionRequest.findUnique({
    where: { confirmationCodeHash: sha256(confirmationCode) },
  });
  if (!request) return null;

  return {
    status: request.status,
    affectedConnections: request.affectedConnections,
    requestedAt: request.requestedAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
  };
}
