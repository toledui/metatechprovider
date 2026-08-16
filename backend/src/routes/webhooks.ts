import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { AppError } from "../lib/errors.js";
import { constantTimeEqual, verifyHmacSha256 } from "../lib/security.js";
import { getMetaSettings } from "../settings/service.js";
import { ingestMetaWebhook } from "../webhooks/meta-ingestion.js";

const verificationSchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1).max(512),
  "hub.challenge": z.string().min(1).max(2048),
});

export interface MetaWebhookSecrets {
  appSecret: string;
  verifyToken: string;
}

export interface WebhookRoutesOptions {
  getMetaWebhookSecrets?: () => Promise<MetaWebhookSecrets | null>;
}

async function storedMetaWebhookSecrets(): Promise<MetaWebhookSecrets | null> {
  const setting = await getMetaSettings();
  if (!setting?.enabled || !setting.config.appSecret || !setting.config.webhookVerifyToken) return null;
  return {
    appSecret: setting.config.appSecret,
    verifyToken: setting.config.webhookVerifyToken,
  };
}

export async function webhookRoutes(app: FastifyInstance, options: WebhookRoutesOptions): Promise<void> {
  const getSecrets = options.getMetaWebhookSecrets ?? storedMetaWebhookSecrets;

  app.get("/api/webhooks/meta", async (request, reply) => {
    const parsed = verificationSchema.safeParse(request.query);
    const secrets = await getSecrets();
    if (!secrets) throw new AppError(503, "meta_webhook_not_configured", "El webhook de Meta no está configurado.");
    if (!parsed.success || !constantTimeEqual(parsed.data["hub.verify_token"], secrets.verifyToken)) {
      throw new AppError(403, "meta_webhook_verification_failed", "No fue posible verificar el webhook de Meta.");
    }

    return reply.type("text/plain; charset=utf-8").send(parsed.data["hub.challenge"]);
  });

  app.post("/api/webhooks/meta", async (request, reply) => {
    const secrets = await getSecrets();
    if (!secrets) throw new AppError(503, "meta_webhook_not_configured", "El webhook de Meta no está configurado.");
    const rawBody = request.rawBody;
    if (!rawBody) throw new AppError(400, "raw_body_unavailable", "No fue posible validar el cuerpo del webhook.");
    const signature = request.headers["x-hub-signature-256"];
    if (!verifyHmacSha256(rawBody, typeof signature === "string" ? signature : undefined, secrets.appSecret)) {
      throw new AppError(401, "invalid_meta_signature", "La firma del webhook de Meta no es válida.");
    }

    await ingestMetaWebhook(request.body, rawBody);
    return reply.status(200).send({ received: true });
  });
}
