import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { AppError } from "../lib/errors.js";
import { deauthorizeMetaUser, getDataDeletionStatus, processDataDeletion } from "../meta/compliance.js";
import { verifyMetaSignedRequest } from "../meta/signed-request.js";
import { getMetaSettings } from "../settings/service.js";

const signedRequestSchema = z.object({ signed_request: z.string().min(20).max(16_384) });
const statusParamsSchema = z.object({ code: z.string().min(32).max(128) });

export interface MetaComplianceRoutesOptions {
  getMetaAppSecret?: () => Promise<string | null>;
}

async function storedMetaAppSecret(): Promise<string | null> {
  const setting = await getMetaSettings();
  return setting?.enabled && setting.config.appSecret ? setting.config.appSecret : null;
}

export async function metaComplianceRoutes(
  app: FastifyInstance,
  options: MetaComplianceRoutesOptions,
): Promise<void> {
  const getAppSecret = options.getMetaAppSecret ?? storedMetaAppSecret;

  app.post("/api/meta/deauthorize", async (request) => {
    const parsed = signedRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "signed_request_required", "Meta no envió un signed_request válido.");
    const appSecret = await getAppSecret();
    if (!appSecret) throw new AppError(503, "meta_not_configured", "La configuración Meta no está activa.");

    const signedPayload = verifyMetaSignedRequest(parsed.data.signed_request, appSecret);
    const disconnectedConnections = await deauthorizeMetaUser(signedPayload.userId);
    return { success: true, disconnectedConnections };
  });

  app.post("/api/meta/data-deletion", async (request) => {
    const parsed = signedRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(422, "signed_request_required", "Meta no envió un signed_request válido.");
    const appSecret = await getAppSecret();
    if (!appSecret) throw new AppError(503, "meta_not_configured", "La configuración Meta no está activa.");

    const signedPayload = verifyMetaSignedRequest(parsed.data.signed_request, appSecret);
    const result = await processDataDeletion(parsed.data.signed_request, signedPayload.userId, appSecret);
    return {
      url: result.statusUrl,
      confirmation_code: result.confirmationCode,
    };
  });

  app.get("/api/meta/data-deletion/status/:code", async (request) => {
    const parsed = statusParamsSchema.safeParse(request.params);
    if (!parsed.success) throw new AppError(404, "deletion_request_not_found", "Solicitud no encontrada.");
    const status = await getDataDeletionStatus(parsed.data.code);
    if (!status) throw new AppError(404, "deletion_request_not_found", "Solicitud no encontrada.");
    return status;
  });
}
