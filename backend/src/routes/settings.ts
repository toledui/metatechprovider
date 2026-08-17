import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSameOrigin, requireSuperAdmin } from "../auth/session.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { resolveSmtpTransportSecurity, sendSmtpTest } from "../mail/service.js";
import {
  getMetaSettings,
  getSmtpSettings,
  SETTING_PROVIDERS,
  writeSetting,
  type MetaSettings,
  type SmtpSettings,
} from "../settings/service.js";

const smtpSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  username: z.string().trim().max(255),
  password: z.string().max(2_048).optional(),
  fromName: z.string().trim().min(1).max(150),
  fromEmail: z.email().max(320),
  replyTo: z.union([z.literal(""), z.email().max(320)]),
});

const metaSchema = z.object({
  enabled: z.boolean(),
  appId: z.string().trim().min(1).max(64),
  appSecret: z.string().max(512).optional(),
  configId: z.string().trim().min(1).max(128),
  webhookVerifyToken: z.string().max(512).optional(),
});

const smtpTestSchema = z.object({ recipient: z.email().max(320) });
const smtpTestCooldown = new Map<bigint, number>();

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/settings", async (request) => {
    await requireSuperAdmin(request);
    const [smtp, meta] = await Promise.all([
      getSmtpSettings(false),
      getMetaSettings(),
    ]);

    return {
      encryptionConfigured: Boolean(env.credentialsEncryptionKey),
      providers: [
        { id: "smtp", name: "SMTP", available: true, configured: Boolean(smtp), enabled: smtp?.enabled ?? false },
        { id: "meta", name: "Meta", available: true, configured: Boolean(meta), enabled: meta?.enabled ?? false },
        { id: "stripe", name: "Stripe", available: false, configured: false, enabled: false },
      ],
      smtp: smtp
        ? {
            enabled: smtp.enabled,
            host: smtp.config.host,
            port: smtp.config.port,
            secure: resolveSmtpTransportSecurity(smtp.config.port, smtp.config.secure).secure,
            username: smtp.config.username,
            passwordConfigured: Boolean(smtp.config.password),
            fromName: smtp.config.fromName,
            fromEmail: smtp.config.fromEmail,
            replyTo: smtp.config.replyTo,
            updatedAt: smtp.updatedAt.toISOString(),
          }
        : null,
      meta: meta
        ? {
            enabled: meta.enabled,
            appId: meta.config.appId,
            appSecretConfigured: Boolean(meta.config.appSecret),
            webhookVerifyTokenConfigured: Boolean(meta.config.webhookVerifyToken),
            configId: meta.config.configId,
            graphApiVersion: env.metaGraphApiVersion,
            source: meta.updatedAt.getTime() === 0 ? "environment" : "database",
            updatedAt: meta.updatedAt.getTime() === 0 ? null : meta.updatedAt.toISOString(),
          }
        : null,
      stripe: { available: false, message: "Preparado para una integración futura." },
    };
  });

  app.put("/api/admin/settings/smtp", async (request) => {
    assertSameOrigin(request);
    const auth = await requireSuperAdmin(request);
    const parsed = smtpSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, "validation_error", "Revisa la configuración SMTP.", parsed.error.flatten());
    }

    const existing = await getSmtpSettings(false);
    const password = parsed.data.password?.trim() || existing?.config.password || "";
    if (parsed.data.username && !password) {
      throw new AppError(422, "smtp_password_required", "Ingresa la contraseña SMTP.");
    }

    const security = resolveSmtpTransportSecurity(parsed.data.port, parsed.data.secure);
    const config: SmtpSettings = {
      host: parsed.data.host,
      port: parsed.data.port,
      secure: security.secure,
      username: parsed.data.username,
      password,
      fromName: parsed.data.fromName,
      fromEmail: parsed.data.fromEmail,
      replyTo: parsed.data.replyTo,
    };
    await writeSetting(SETTING_PROVIDERS.SMTP, config, parsed.data.enabled, auth.userId);
    return { success: true, passwordConfigured: Boolean(password) };
  });

  app.post("/api/admin/settings/smtp/test", async (request) => {
    assertSameOrigin(request);
    const auth = await requireSuperAdmin(request);
    const parsed = smtpTestSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "validation_error", "Ingresa un destinatario válido.");

    const smtp = await getSmtpSettings(false);
    if (!smtp) throw new AppError(409, "smtp_not_configured", "Guarda la configuración SMTP antes de probarla.");
    const lastTest = smtpTestCooldown.get(auth.userId) ?? 0;
    if (Date.now() - lastTest < 30_000) {
      throw new AppError(429, "smtp_test_rate_limited", "Espera 30 segundos antes de enviar otra prueba.");
    }
    smtpTestCooldown.set(auth.userId, Date.now());
    const result = await sendSmtpTest(smtp.config, parsed.data.recipient);

    return { success: true, ...result };
  });

  app.put("/api/admin/settings/meta", async (request) => {
    assertSameOrigin(request);
    const auth = await requireSuperAdmin(request);
    const parsed = metaSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, "validation_error", "Revisa la configuración de Meta.", parsed.error.flatten());
    }

    const existing = await getMetaSettings();
    const appSecret = parsed.data.appSecret?.trim() || existing?.config.appSecret || "";
    const webhookVerifyToken =
      parsed.data.webhookVerifyToken?.trim() || existing?.config.webhookVerifyToken || "";
    if (!appSecret) throw new AppError(422, "meta_app_secret_required", "Ingresa el App Secret de Meta.");

    const config: MetaSettings = {
      appId: parsed.data.appId,
      appSecret,
      configId: parsed.data.configId,
      webhookVerifyToken,
    };
    await writeSetting(SETTING_PROVIDERS.META, config, parsed.data.enabled, auth.userId);
    return { success: true, appSecretConfigured: true };
  });
}
