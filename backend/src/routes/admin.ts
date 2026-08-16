import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSameOrigin, requireSuperAdmin } from "../auth/session.js";
import { TenantStatus, WhatsAppConnectionStatus } from "../generated/prisma/enums.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const tenantStatusSchema = z.object({ status: z.enum(TenantStatus) });
const tenantParamsSchema = z.object({ tenantId: z.string().min(1).max(30) });

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/overview", async (request) => {
    await requireSuperAdmin(request);
    const [tenants, activeTenants, users, connections, activeConnections, failedWebhooks] =
      await prisma.$transaction([
        prisma.tenant.count({ where: { deletedAt: null } }),
        prisma.tenant.count({ where: { status: TenantStatus.ACTIVE, deletedAt: null } }),
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.whatsAppConnection.count({ where: { deletedAt: null } }),
        prisma.whatsAppConnection.count({
          where: { status: WhatsAppConnectionStatus.ACTIVE, deletedAt: null },
        }),
        prisma.webhookLog.count({ where: { status: "FAILED" } }),
      ]);

    return {
      metrics: { tenants, activeTenants, users, connections, activeConnections, failedWebhooks },
    };
  });

  app.get("/api/admin/tenants", async (request) => {
    await requireSuperAdmin(request);
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { users: true, whatsappConnections: true } } },
      orderBy: { createdAt: "desc" },
      take: 250,
    });

    return {
      tenants: tenants.map((tenant) => ({
        id: tenant.publicId,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        timezone: tenant.timezone,
        users: tenant._count.users,
        connections: tenant._count.whatsappConnections,
        createdAt: tenant.createdAt.toISOString(),
      })),
    };
  });

  app.patch("/api/admin/tenants/:tenantId/status", async (request) => {
    assertSameOrigin(request);
    const auth = await requireSuperAdmin(request);
    const params = tenantParamsSchema.safeParse(request.params);
    const body = tenantStatusSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      throw new AppError(422, "validation_error", "Estado o tenant inválido.");
    }

    const tenant = await prisma.tenant.findUnique({ where: { publicId: params.data.tenantId } });
    if (!tenant || tenant.deletedAt) throw new AppError(404, "tenant_not_found", "Tenant no encontrado.");
    if (tenant.id === auth.tenantId && body.data.status === TenantStatus.SUSPENDED) {
      throw new AppError(409, "cannot_suspend_own_tenant", "No puedes suspender el tenant de tu propia sesión.");
    }

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: body.data.status },
    });
    return { tenant: { id: updated.publicId, status: updated.status } };
  });

  app.get("/api/admin/users", async (request) => {
    await requireSuperAdmin(request);
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      include: { tenant: { select: { publicId: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 250,
    });

    return {
      users: users.map((user) => ({
        id: user.publicId,
        name: user.name,
        email: user.email,
        role: user.role,
        platformRole: user.platformRole,
        status: user.status,
        tenant: { id: user.tenant.publicId, name: user.tenant.name },
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      })),
    };
  });

  app.get("/api/admin/connections", async (request) => {
    await requireSuperAdmin(request);
    const connections = await prisma.whatsAppConnection.findMany({
      where: { deletedAt: null },
      include: { tenant: { select: { publicId: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 250,
    });

    return {
      connections: connections.map((connection) => ({
        id: connection.publicId,
        tenant: { id: connection.tenant.publicId, name: connection.tenant.name },
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        displayPhoneNumber: connection.displayPhoneNumber,
        verifiedName: connection.verifiedName,
        status: connection.status,
        coexistenceEnabled: connection.coexistenceEnabled,
        connectedAt: connection.connectedAt?.toISOString() ?? null,
      })),
    };
  });
}
