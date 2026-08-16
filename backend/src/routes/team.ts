import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSameOrigin, createSession, requireAuth } from "../auth/session.js";
import {
  TenantInvitationStatus,
  UserRole,
  UserStatus,
} from "../generated/prisma/enums.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createOpaqueToken, hashPassword, sha256 } from "../lib/security.js";
import { sendAppEmail, type AppEmail } from "../mail/service.js";
import { tenantInvitationEmail } from "../mail/templates.js";

const INVITATION_TTL_MS = 72 * 60 * 60 * 1_000;
const emailSchema = z.email().max(191).transform((value) => value.toLowerCase());
const memberParamsSchema = z.object({ memberId: z.string().min(1).max(30) });
const invitationParamsSchema = z.object({ invitationId: z.string().min(1).max(30) });
const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum([UserRole.ADMIN, UserRole.MEMBER]),
});
const acceptSchema = z.object({
  token: z.string().min(32).max(256),
  name: z.string().trim().min(2).max(150),
  password: z.string().min(12).max(128),
});
const roleSchema = z.object({ role: z.enum([UserRole.ADMIN, UserRole.MEMBER]) });
const transferSchema = z.object({ newOwnerId: z.string().min(1).max(30) });

export interface TeamRoutesOptions {
  sendEmail?: (email: AppEmail) => Promise<unknown>;
}

function assertCanManageTeam(role: string): void {
  if (role !== UserRole.OWNER && role !== UserRole.ADMIN) {
    throw new AppError(403, "team_admin_required", "Solo un owner o admin puede administrar el equipo.");
  }
}

function publicMember(member: {
  publicId: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: member.publicId,
    name: member.name,
    email: member.email,
    role: member.role,
    status: member.status,
    lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
    createdAt: member.createdAt.toISOString(),
  };
}

function publicInvitation(invitation: {
  publicId: string;
  email: string;
  role: UserRole;
  status: TenantInvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  invitedBy: { name: string };
}) {
  const status = invitation.status === TenantInvitationStatus.PENDING && invitation.expiresAt <= new Date()
    ? TenantInvitationStatus.EXPIRED
    : invitation.status;
  return {
    id: invitation.publicId,
    email: invitation.email,
    role: invitation.role,
    status,
    invitedBy: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

export async function teamRoutes(app: FastifyInstance, options: TeamRoutesOptions): Promise<void> {
  const deliver = options.sendEmail ?? sendAppEmail;

  app.get("/api/team", async (request) => {
    const auth = await requireAuth(request);
    await prisma.tenantInvitation.updateMany({
      where: {
        tenantId: auth.tenantId,
        status: TenantInvitationStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: TenantInvitationStatus.EXPIRED },
    });
    const [members, invitations] = await prisma.$transaction([
      prisma.user.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      }),
      prisma.tenantInvitation.findMany({
        where: { tenantId: auth.tenantId },
        include: { invitedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    return { members: members.map(publicMember), invitations: invitations.map(publicInvitation) };
  });

  app.post("/api/team/invitations", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    assertCanManageTeam(auth.userRole);
    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, "validation_error", "Revisa el correo y el rol de la invitación.", parsed.error.flatten());
    }

    const existingUser = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existingUser && (existingUser.tenantId !== auth.tenantId || !existingUser.deletedAt)) {
      throw new AppError(409, "email_unavailable", "Ese correo ya pertenece a una cuenta activa.");
    }

    const token = createOpaqueToken();
    const invitation = await prisma.$transaction(async (transaction) => {
      await transaction.tenantInvitation.updateMany({
        where: {
          tenantId: auth.tenantId,
          email: parsed.data.email,
          status: TenantInvitationStatus.PENDING,
        },
        data: { status: TenantInvitationStatus.REVOKED, revokedAt: new Date() },
      });
      const created = await transaction.tenantInvitation.create({
        data: {
          tenantId: auth.tenantId,
          invitedByUserId: auth.userId,
          email: parsed.data.email,
          role: parsed.data.role,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
        include: { invitedBy: { select: { name: true } } },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: "team.invitation.created",
          entityType: "tenant_invitation",
          entityPublicId: created.publicId,
          metadata: { email: created.email, role: created.role },
          ipAddress: request.ip.slice(0, 64),
        },
      });
      return created;
    });

    try {
      await deliver(tenantInvitationEmail(
        invitation.email,
        auth.tenantName,
        auth.userName,
        invitation.role as "ADMIN" | "MEMBER",
        token,
      ));
    } catch {
      await prisma.tenantInvitation.update({
        where: { id: invitation.id },
        data: { status: TenantInvitationStatus.REVOKED, revokedAt: new Date() },
      });
      throw new AppError(503, "invitation_delivery_failed", "No fue posible enviar la invitación. Revisa la configuración SMTP.");
    }

    reply.status(201);
    return { invitation: publicInvitation(invitation) };
  });

  app.delete("/api/team/invitations/:invitationId", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    assertCanManageTeam(auth.userRole);
    const params = invitationParamsSchema.safeParse(request.params);
    if (!params.success) throw new AppError(422, "validation_error", "Invitación inválida.");
    const invitation = await prisma.tenantInvitation.findFirst({
      where: { publicId: params.data.invitationId, tenantId: auth.tenantId },
    });
    if (!invitation) throw new AppError(404, "invitation_not_found", "Invitación no encontrada.");
    if (invitation.status === TenantInvitationStatus.PENDING) {
      await prisma.$transaction([
        prisma.tenantInvitation.update({
          where: { id: invitation.id },
          data: { status: TenantInvitationStatus.REVOKED, revokedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            tenantId: auth.tenantId,
            actorUserId: auth.userId,
            action: "team.invitation.revoked",
            entityType: "tenant_invitation",
            entityPublicId: invitation.publicId,
            metadata: { email: invitation.email },
            ipAddress: request.ip.slice(0, 64),
          },
        }),
      ]);
    }
    return reply.status(204).send();
  });

  app.get("/api/team/invitations/preview", async (request) => {
    const parsed = z.object({ token: z.string().min(32).max(256) }).safeParse(request.query);
    if (!parsed.success) throw new AppError(422, "invalid_invitation", "La invitación no es válida.");
    const invitation = await prisma.tenantInvitation.findUnique({
      where: { tokenHash: sha256(parsed.data.token) },
      include: { tenant: { select: { name: true } }, invitedBy: { select: { name: true } } },
    });
    if (!invitation || invitation.status !== TenantInvitationStatus.PENDING || invitation.expiresAt <= new Date()) {
      throw new AppError(400, "invalid_invitation", "La invitación expiró, fue revocada o ya se utilizó.");
    }
    return {
      invitation: {
        email: invitation.email,
        role: invitation.role,
        tenantName: invitation.tenant.name,
        invitedBy: invitation.invitedBy.name,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    };
  });

  app.post("/api/team/invitations/accept", async (request, reply) => {
    assertSameOrigin(request);
    const parsed = acceptSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, "validation_error", "Revisa tu nombre y usa una contraseña de al menos 12 caracteres.", parsed.error.flatten());
    }
    const invitation = await prisma.tenantInvitation.findUnique({
      where: { tokenHash: sha256(parsed.data.token) },
    });
    if (!invitation || invitation.status !== TenantInvitationStatus.PENDING || invitation.expiresAt <= new Date()) {
      throw new AppError(400, "invalid_invitation", "La invitación expiró, fue revocada o ya se utilizó.");
    }
    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
    if (existingUser && (existingUser.tenantId !== invitation.tenantId || !existingUser.deletedAt)) {
      throw new AppError(409, "email_unavailable", "Ese correo ya pertenece a una cuenta activa.");
    }
    const passwordHash = await hashPassword(parsed.data.password);
    const now = new Date();
    const user = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.tenantInvitation.updateMany({
        where: {
          id: invitation.id,
          status: TenantInvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
        data: { status: TenantInvitationStatus.ACCEPTED, acceptedAt: now },
      });
      if (claimed.count !== 1) {
        throw new AppError(400, "invalid_invitation", "La invitación ya no está disponible.");
      }
      const acceptedUser = existingUser
        ? await transaction.user.update({
            where: { id: existingUser.id },
            data: {
              name: parsed.data.name,
              passwordHash,
              role: invitation.role,
              status: UserStatus.ACTIVE,
              deletedAt: null,
            },
          })
        : await transaction.user.create({
            data: {
              tenantId: invitation.tenantId,
              name: parsed.data.name,
              email: invitation.email,
              passwordHash,
              role: invitation.role,
              status: UserStatus.ACTIVE,
            },
          });
      await transaction.auditLog.create({
        data: {
          tenantId: invitation.tenantId,
          actorUserId: acceptedUser.id,
          action: "team.invitation.accepted",
          entityType: "user",
          entityPublicId: acceptedUser.publicId,
          metadata: { role: acceptedUser.role },
          ipAddress: request.ip.slice(0, 64),
        },
      });
      return acceptedUser;
    });
    await createSession(reply, user.id, request);
    reply.status(201);
    return { accepted: true, redirectTo: "/dashboard" };
  });

  app.patch("/api/team/members/:memberId/role", async (request) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    if (auth.userRole !== UserRole.OWNER) {
      throw new AppError(403, "owner_required", "Solo el owner puede cambiar roles.");
    }
    const params = memberParamsSchema.safeParse(request.params);
    const body = roleSchema.safeParse(request.body);
    if (!params.success || !body.success) throw new AppError(422, "validation_error", "Miembro o rol inválido.");
    const member = await prisma.user.findFirst({
      where: { publicId: params.data.memberId, tenantId: auth.tenantId, deletedAt: null },
    });
    if (!member) throw new AppError(404, "member_not_found", "Miembro no encontrado.");
    if (member.role === UserRole.OWNER || member.id === auth.userId) {
      throw new AppError(409, "protected_owner", "El rol del owner se modifica mediante transferencia de propiedad.");
    }
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.user.update({ where: { id: member.id }, data: { role: body.data.role } });
      await transaction.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: "team.member.role_changed",
          entityType: "user",
          entityPublicId: member.publicId,
          metadata: { from: member.role, to: body.data.role },
          ipAddress: request.ip.slice(0, 64),
        },
      });
      return result;
    });
    return { member: publicMember(updated) };
  });

  app.delete("/api/team/members/:memberId", async (request, reply) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    assertCanManageTeam(auth.userRole);
    const params = memberParamsSchema.safeParse(request.params);
    if (!params.success) throw new AppError(422, "validation_error", "Miembro inválido.");
    const member = await prisma.user.findFirst({
      where: { publicId: params.data.memberId, tenantId: auth.tenantId, deletedAt: null },
    });
    if (!member) throw new AppError(404, "member_not_found", "Miembro no encontrado.");
    if (member.id === auth.userId || member.role === UserRole.OWNER) {
      throw new AppError(409, "protected_member", "No puedes retirar al owner ni tu propia cuenta.");
    }
    if (auth.userRole === UserRole.ADMIN && member.role !== UserRole.MEMBER) {
      throw new AppError(403, "owner_required", "Un admin solo puede retirar miembros con rol Member.");
    }
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      await transaction.session.updateMany({ where: { userId: member.id, revokedAt: null }, data: { revokedAt: now } });
      await transaction.user.update({
        where: { id: member.id },
        data: { status: UserStatus.DISABLED, deletedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: "team.member.removed",
          entityType: "user",
          entityPublicId: member.publicId,
          metadata: { email: member.email, role: member.role },
          ipAddress: request.ip.slice(0, 64),
        },
      });
    });
    return reply.status(204).send();
  });

  app.post("/api/team/ownership/transfer", async (request) => {
    assertSameOrigin(request);
    const auth = await requireAuth(request);
    if (auth.userRole !== UserRole.OWNER) {
      throw new AppError(403, "owner_required", "Solo el owner actual puede transferir la propiedad.");
    }
    const parsed = transferSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "validation_error", "Selecciona un nuevo owner válido.");
    const target = await prisma.user.findFirst({
      where: {
        publicId: parsed.data.newOwnerId,
        tenantId: auth.tenantId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
    });
    if (!target || target.id === auth.userId || target.role === UserRole.OWNER) {
      throw new AppError(422, "invalid_new_owner", "Selecciona otro miembro activo del tenant.");
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({ where: { id: auth.userId }, data: { role: UserRole.ADMIN } });
      await transaction.user.update({ where: { id: target.id }, data: { role: UserRole.OWNER } });
      await transaction.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: "team.ownership.transferred",
          entityType: "user",
          entityPublicId: target.publicId,
          metadata: { previousOwnerId: auth.userPublicId, newOwnerId: target.publicId },
          ipAddress: request.ip.slice(0, 64),
        },
      });
    });
    return { transferred: true, newOwnerId: target.publicId };
  });
}
