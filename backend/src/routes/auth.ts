import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSameOrigin, createSession, requireAuth, revokeCurrentSession } from "../auth/session.js";
import { findUsableToken, hasRecentToken, issueUserToken, userTokenTtl } from "../auth/user-tokens.js";
import { UserRole, UserStatus, UserTokenType } from "../generated/prisma/enums.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/security.js";
import { tenantSlug } from "../lib/slug.js";
import { sendAppEmail, type AppEmail } from "../mail/service.js";
import { passwordChangedEmail, passwordResetEmail, verificationEmail } from "../mail/templates.js";

const emailSchema = z.email().max(191).transform((value) => value.toLowerCase());
const tokenSchema = z.string().min(32).max(256);

const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(150),
  name: z.string().trim().min(2).max(150),
  email: emailSchema,
  password: z.string().min(12).max(128),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: z.string().min(12).max(128),
});

const genericRecoveryMessage = "Si existe una cuenta activa con ese correo, recibirás instrucciones en unos minutos.";
const genericResendMessage = "Si la cuenta está pendiente, enviaremos un nuevo enlace de verificación.";

export interface AuthRoutesOptions {
  sendEmail?: (email: AppEmail) => Promise<unknown>;
}

function publicAuth(auth: Awaited<ReturnType<typeof requireAuth>>) {
  return {
    user: {
      id: auth.userPublicId,
      name: auth.userName,
      email: auth.userEmail,
      role: auth.userRole,
      platformRole: auth.platformRole,
    },
    tenant: {
      id: auth.tenantPublicId,
      name: auth.tenantName,
      slug: auth.tenantSlug,
    },
  };
}

async function deliverSilently(deliver: (email: AppEmail) => Promise<unknown>, email: AppEmail): Promise<boolean> {
  try {
    await deliver(email);
    return true;
  } catch {
    return false;
  }
}

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const deliver = options.sendEmail ?? sendAppEmail;

  app.post("/api/auth/register", async (request, reply) => {
    assertSameOrigin(request);
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, "validation_error", "Revisa los datos del formulario.", parsed.error.flatten());
    }

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) throw new AppError(409, "email_in_use", "Ese correo ya tiene una cuenta.");

    const passwordHash = await hashPassword(parsed.data.password);
    const result = await prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenant.create({
        data: { name: parsed.data.organizationName, slug: tenantSlug(parsed.data.organizationName) },
      });
      const user = await transaction.user.create({
        data: {
          tenantId: tenant.id,
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          role: UserRole.OWNER,
          status: UserStatus.PENDING_EMAIL_VERIFICATION,
        },
      });

      return { tenant, user };
    });

    const token = await issueUserToken(
      result.user.id,
      UserTokenType.EMAIL_VERIFICATION,
      userTokenTtl.emailVerificationMs,
      request.ip,
    );
    const emailSent = await deliverSilently(deliver, verificationEmail(result.user.email, result.user.name, token));

    reply.status(201);
    return {
      requiresEmailVerification: true,
      email: result.user.email,
      emailSent,
      message: emailSent
        ? "Cuenta creada. Revisa tu correo para activarla."
        : "Cuenta creada, pero el correo no pudo enviarse. Puedes solicitar un nuevo enlace.",
    };
  });

  app.post("/api/auth/email-verification/verify", async (request) => {
    assertSameOrigin(request);
    const parsed = z.object({ token: tokenSchema }).safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "invalid_verification_token", "El enlace de verificación no es válido.");

    const storedToken = await findUsableToken(parsed.data.token, UserTokenType.EMAIL_VERIFICATION);
    if (!storedToken || storedToken.user.status !== UserStatus.PENDING_EMAIL_VERIFICATION) {
      throw new AppError(400, "invalid_verification_token", "El enlace expiró, ya fue utilizado o no es válido.");
    }

    await prisma.$transaction(async (transaction) => {
      const now = new Date();
      const consumed = await transaction.userToken.updateMany({
        where: { id: storedToken.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new AppError(400, "invalid_verification_token", "El enlace expiró, ya fue utilizado o no es válido.");
      }
      await transaction.user.update({
        where: { id: storedToken.userId },
        data: { status: UserStatus.ACTIVE },
      });
      await transaction.userToken.updateMany({
        where: { userId: storedToken.userId, type: UserTokenType.EMAIL_VERIFICATION, consumedAt: null },
        data: { consumedAt: now },
      });
    });

    return { verified: true, message: "Correo confirmado. Ya puedes iniciar sesión." };
  });

  app.post("/api/auth/email-verification/resend", async (request) => {
    assertSameOrigin(request);
    const parsed = z.object({ email: emailSchema }).safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "validation_error", "Escribe un correo válido.");

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (
      user?.status === UserStatus.PENDING_EMAIL_VERIFICATION &&
      !(await hasRecentToken(user.id, UserTokenType.EMAIL_VERIFICATION))
    ) {
      const token = await issueUserToken(
        user.id,
        UserTokenType.EMAIL_VERIFICATION,
        userTokenTtl.emailVerificationMs,
        request.ip,
      );
      await deliverSilently(deliver, verificationEmail(user.email, user.name, token));
    }

    return { accepted: true, message: genericResendMessage };
  });

  app.post("/api/auth/password/forgot", async (request) => {
    assertSameOrigin(request);
    const parsed = z.object({ email: emailSchema }).safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "validation_error", "Escribe un correo válido.");

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user?.status === UserStatus.ACTIVE && !(await hasRecentToken(user.id, UserTokenType.PASSWORD_RESET))) {
      const token = await issueUserToken(
        user.id,
        UserTokenType.PASSWORD_RESET,
        userTokenTtl.passwordResetMs,
        request.ip,
      );
      await deliverSilently(deliver, passwordResetEmail(user.email, user.name, token));
    }

    return { accepted: true, message: genericRecoveryMessage };
  });

  app.post("/api/auth/password/reset", async (request) => {
    assertSameOrigin(request);
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "validation_error", "El enlace o la nueva contraseña no son válidos.");

    const storedToken = await findUsableToken(parsed.data.token, UserTokenType.PASSWORD_RESET);
    if (!storedToken || storedToken.user.status !== UserStatus.ACTIVE) {
      throw new AppError(400, "invalid_reset_token", "El enlace expiró, ya fue utilizado o no es válido.");
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      const consumed = await transaction.userToken.updateMany({
        where: { id: storedToken.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new AppError(400, "invalid_reset_token", "El enlace expiró, ya fue utilizado o no es válido.");
      }
      await transaction.user.update({ where: { id: storedToken.userId }, data: { passwordHash } });
      await transaction.userToken.updateMany({
        where: { userId: storedToken.userId, type: UserTokenType.PASSWORD_RESET, consumedAt: null },
        data: { consumedAt: now },
      });
      await transaction.session.updateMany({
        where: { userId: storedToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    await deliverSilently(deliver, passwordChangedEmail(storedToken.user.email, storedToken.user.name));
    return { reset: true, message: "Contraseña actualizada. Inicia sesión nuevamente." };
  });

  app.post("/api/auth/login", async (request, reply) => {
    assertSameOrigin(request);
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "validation_error", "Correo o contraseña inválidos.");

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      include: { tenant: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      throw new AppError(401, "invalid_credentials", "Correo o contraseña inválidos.");
    }

    await Promise.all([
      createSession(reply, user.id, request),
      prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    ]);
    return {
      user: {
        id: user.publicId,
        name: user.name,
        email: user.email,
        role: user.role,
        platformRole: user.platformRole,
      },
      tenant: {
        id: user.tenant.publicId,
        name: user.tenant.name,
        slug: user.tenant.slug,
      },
    };
  });

  app.get("/api/auth/me", async (request) => publicAuth(await requireAuth(request)));

  app.post("/api/auth/logout", async (request, reply) => {
    assertSameOrigin(request);
    await revokeCurrentSession(request, reply);
    reply.status(204).send();
  });
}
