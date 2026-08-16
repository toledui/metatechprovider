import { PlatformRole, TenantStatus, UserRole, UserStatus } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/security.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const email = required("SUPERADMIN_EMAIL").toLowerCase();
const password = required("SUPERADMIN_PASSWORD");
const name = process.env.SUPERADMIN_NAME?.trim() || "Superadmin THagencia";

if (password.length < 12) throw new Error("SUPERADMIN_PASSWORD must contain at least 12 characters");

try {
  const passwordHash = await hashPassword(password);
  const result = await prisma.$transaction(async (transaction) => {
    const tenant = await transaction.tenant.upsert({
      where: { slug: "thagencia-internal" },
      update: { name: "THagencia", status: TenantStatus.ACTIVE, deletedAt: null },
      create: { name: "THagencia", slug: "thagencia-internal", status: TenantStatus.ACTIVE },
    });
    const user = await transaction.user.upsert({
      where: { email },
      update: {
        tenantId: tenant.id,
        name,
        passwordHash,
        role: UserRole.OWNER,
        platformRole: PlatformRole.SUPERADMIN,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        tenantId: tenant.id,
        name,
        email,
        passwordHash,
        role: UserRole.OWNER,
        platformRole: PlatformRole.SUPERADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await transaction.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { tenant, user };
  });

  console.log(`Superadmin ready: ${result.user.email} (${result.tenant.slug})`);
} finally {
  await prisma.$disconnect();
}
