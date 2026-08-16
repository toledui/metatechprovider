import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { decryptCredential, encryptCredential } from "../lib/security.js";

export const SETTING_PROVIDERS = {
  SMTP: "smtp",
  META: "meta",
  STRIPE: "stripe",
} as const;

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
}

export interface MetaSettings {
  appId: string;
  appSecret: string;
  configId: string;
  webhookVerifyToken: string;
}

export interface StoredSetting<T> {
  provider: string;
  enabled: boolean;
  config: T;
  updatedAt: Date;
}

export async function readSetting<T>(provider: string): Promise<StoredSetting<T> | null> {
  const setting = await prisma.platformSetting.findUnique({ where: { provider } });
  if (!setting) return null;

  return {
    provider: setting.provider,
    enabled: setting.enabled,
    config: JSON.parse(decryptCredential(setting.configEncrypted)) as T,
    updatedAt: setting.updatedAt,
  };
}

export async function writeSetting<T>(
  provider: string,
  config: T,
  enabled: boolean,
  updatedByUserId: bigint,
): Promise<void> {
  const configEncrypted = encryptCredential(JSON.stringify(config));
  await prisma.platformSetting.upsert({
    where: { provider },
    update: {
      configEncrypted,
      enabled,
      updatedByUserId,
      version: { increment: 1 },
    },
    create: { provider, configEncrypted, enabled, updatedByUserId },
  });
}

export async function getMetaSettings(): Promise<StoredSetting<MetaSettings> | null> {
  const stored = await readSetting<MetaSettings>(SETTING_PROVIDERS.META);
  if (stored) return stored;

  if (!env.metaAppId || !env.metaAppSecret || !env.metaConfigId) return null;
  return {
    provider: SETTING_PROVIDERS.META,
    enabled: true,
    config: {
      appId: env.metaAppId,
      appSecret: env.metaAppSecret,
      configId: env.metaConfigId,
      webhookVerifyToken: env.metaWebhookVerifyToken ?? "",
    },
    updatedAt: new Date(0),
  };
}

export async function getSmtpSettings(requireEnabled = true): Promise<StoredSetting<SmtpSettings> | null> {
  const stored = await readSetting<SmtpSettings>(SETTING_PROVIDERS.SMTP);
  if (!stored || (requireEnabled && !stored.enabled)) return null;
  return stored;
}
