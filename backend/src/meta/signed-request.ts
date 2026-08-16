import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { AppError } from "../lib/errors.js";

const signedPayloadSchema = z.object({
  algorithm: z.literal("HMAC-SHA256"),
  user_id: z.string().min(1).max(64),
  issued_at: z.number().optional(),
});

export interface MetaSignedPayload {
  algorithm: "HMAC-SHA256";
  userId: string;
  issuedAt?: number;
}

export function verifyMetaSignedRequest(signedRequest: string, appSecret: string): MetaSignedPayload {
  const [encodedSignature, encodedPayload, ...rest] = signedRequest.split(".");
  if (!encodedSignature || !encodedPayload || rest.length > 0) {
    throw new AppError(400, "invalid_signed_request", "El signed_request de Meta no es válido.");
  }

  let signature: Buffer;
  let payload: unknown;
  try {
    signature = Buffer.from(encodedSignature, "base64url");
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new AppError(400, "invalid_signed_request", "El signed_request de Meta no se puede decodificar.");
  }

  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    throw new AppError(401, "invalid_meta_signature", "La firma del signed_request de Meta no es válida.");
  }

  const parsed = signedPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(400, "invalid_signed_request_payload", "El signed_request no contiene un usuario Meta válido.");
  }

  return {
    algorithm: parsed.data.algorithm,
    userId: parsed.data.user_id,
    ...(parsed.data.issued_at === undefined ? {} : { issuedAt: parsed.data.issued_at }),
  };
}
