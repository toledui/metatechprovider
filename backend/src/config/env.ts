import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

function stringValue(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function integerValue(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return value;
}

function optionalString(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value === "" || value === undefined ? undefined : value;
}

function originList(name: string): readonly string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

const metaGraphApiVersion = stringValue("META_GRAPH_API_VERSION", "v26.0");

if (!/^v\d+\.\d+$/.test(metaGraphApiVersion)) {
  throw new Error("META_GRAPH_API_VERSION must use the format v26.0");
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: stringValue("HOST", "127.0.0.1"),
  port: integerValue("PORT", 3001),
  appOrigin: stringValue("APP_ORIGIN", "https://localhost:3000").replace(/\/$/, ""),
  devAllowedOrigins: originList("DEV_ALLOWED_ORIGINS"),
  sessionTtlDays: integerValue("SESSION_TTL_DAYS", 7),
  webhookWorkerPollMs: integerValue("WEBHOOK_WORKER_POLL_MS", 1_000),
  webhookDeliveryTimeoutMs: integerValue("WEBHOOK_DELIVERY_TIMEOUT_MS", 10_000),
  webhookDeliveryMaxAttempts: integerValue("WEBHOOK_DELIVERY_MAX_ATTEMPTS", 5),
  apiRateLimitPerMinute: integerValue("API_RATE_LIMIT_PER_MINUTE", 60),
  metaMessageTimeoutMs: integerValue("META_MESSAGE_TIMEOUT_MS", 15_000),
  credentialsEncryptionKey: optionalString("CREDENTIALS_ENCRYPTION_KEY"),
  metaGraphApiVersion,
  metaGraphApiBaseUrl: stringValue(
    "META_GRAPH_API_BASE_URL",
    "https://graph.facebook.com",
  ).replace(/\/$/, ""),
  metaAppId: optionalString("META_APP_ID"),
  metaAppSecret: optionalString("META_APP_SECRET"),
  metaConfigId: optionalString("META_CONFIG_ID"),
  metaWebhookVerifyToken: optionalString("META_WEBHOOK_VERIFY_TOKEN"),
});
