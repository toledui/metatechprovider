import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

import { env } from "../config/env.js";
import { AppError } from "./errors.js";

const PASSWORD_KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt);

  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = encoded.split("$");

  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;

  const expected = Buffer.from(hashValue, "base64url");
  const actual = await scryptAsync(password, Buffer.from(saltValue, "base64url"));

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(value: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function verifyHmacSha256(
  value: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const receivedHex = signatureHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;

  const expected = Buffer.from(hmacSha256(value, secret), "hex");
  const received = Buffer.from(receivedHex, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = Buffer.from(sha256(left), "hex");
  const rightDigest = Buffer.from(sha256(right), "hex");
  return timingSafeEqual(leftDigest, rightDigest);
}

function encryptionKey(): Buffer {
  if (!env.credentialsEncryptionKey) {
    throw new AppError(
      503,
      "encryption_not_configured",
      "CREDENTIALS_ENCRYPTION_KEY no está configurada en backend/.env.",
    );
  }

  const key = Buffer.from(env.credentialsEncryptionKey, "base64");
  if (key.length !== 32) {
    throw new AppError(
      503,
      "invalid_encryption_key",
      "CREDENTIALS_ENCRYPTION_KEY debe contener exactamente 32 bytes codificados en Base64.",
    );
  }

  return key;
}

export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ["v1", iv, tag, ciphertext]
    .map((value) => (typeof value === "string" ? value : value.toString("base64url")))
    .join(".");
}

export function decryptCredential(encoded: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = encoded.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Unsupported encrypted credential format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
