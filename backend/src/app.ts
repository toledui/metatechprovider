import cookie from "@fastify/cookie";
import Fastify from "fastify";

import { env } from "./config/env.js";
import { metaConfig } from "./config/meta.js";
import { AppError } from "./lib/errors.js";
import { prisma } from "./lib/prisma.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { configRoutes } from "./routes/config.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { settingsRoutes } from "./routes/settings.js";
import { sendAppEmail, type AppEmail } from "./mail/service.js";
import { webhookRoutes, type MetaWebhookSecrets } from "./routes/webhooks.js";
import { metaComplianceRoutes } from "./routes/meta-compliance.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { gatewayRoutes } from "./routes/gateway.js";
import { teamRoutes } from "./routes/team.js";
import type { MetaMessageFetcher } from "./gateway/meta-messages.js";

export interface BuildAppOptions {
  sendEmail?: (email: AppEmail) => Promise<unknown>;
  getMetaWebhookSecrets?: () => Promise<MetaWebhookSecrets | null>;
  getMetaAppSecret?: () => Promise<string | null>;
  metaMessageFetcher?: MetaMessageFetcher;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    bodyLimit: 256 * 1024,
    requestTimeout: 20_000,
    trustProxy: env.nodeEnv === "production",
    logger: env.nodeEnv === "production"
      ? {
          level: "info",
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "body.code",
            "body.token",
            "body.password",
            "body.appSecret",
            "body.webhookVerifyToken",
          ],
        }
      : false,
  });

  void app.register(cookie);

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      request.rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      try {
        done(null, JSON.parse(body.toString("utf8")) as unknown);
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        const encodedBody = typeof body === "string" ? body : body.toString("utf8");
        done(null, Object.fromEntries(new URLSearchParams(encodedBody)));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    return payload;
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "thagencia-tech-provider-backend",
    graphApiVersion: metaConfig.graphApiVersion,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ready", database: "connected" };
    } catch {
      reply.status(503);
      return { status: "not_ready", database: "unavailable" };
    }
  });

  void app.register(configRoutes);
  void app.register(authRoutes, { sendEmail: options.sendEmail ?? sendAppEmail });
  void app.register(teamRoutes, { sendEmail: options.sendEmail ?? sendAppEmail });
  void app.register(adminRoutes);
  void app.register(whatsappRoutes);
  void app.register(settingsRoutes);
  void app.register(apiKeyRoutes);
  void app.register(gatewayRoutes, {
    ...(options.metaMessageFetcher ? { metaMessageFetcher: options.metaMessageFetcher } : {}),
  });
  void app.register(webhookRoutes, {
    ...(options.getMetaWebhookSecrets ? { getMetaWebhookSecrets: options.getMetaWebhookSecrets } : {}),
  });
  const getMetaAppSecret = options.getMetaAppSecret ?? (options.getMetaWebhookSecrets
    ? async () => (await options.getMetaWebhookSecrets?.())?.appSecret ?? null
    : undefined);
  void app.register(metaComplianceRoutes, {
    ...(getMetaAppSecret ? { getMetaAppSecret } : {}),
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: "not_found", message: "El recurso solicitado no existe." });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
      return;
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const frameworkStatus = typeof error === "object" && error !== null &&
      "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : undefined;
    if (frameworkStatus && frameworkStatus >= 400 && frameworkStatus < 500) {
      reply.status(frameworkStatus).send({
        error: "invalid_request",
        message: normalizedError.message,
      });
      return;
    }

    if (env.nodeEnv === "production") request.log.error(normalizedError);
    else console.error(`[backend] unhandled ${request.method} ${request.url}`, normalizedError);
    reply.status(500).send({
      error: "internal_server_error",
      message: "Ocurrió un error inesperado.",
      ...(env.nodeEnv === "development"
        ? {
            details: {
              name: normalizedError.name,
              message: normalizedError.message,
              code: typeof error === "object" && error !== null && "code" in error
                ? error.code
                : undefined,
            },
          }
        : {}),
    });
  });

  return app;
}
