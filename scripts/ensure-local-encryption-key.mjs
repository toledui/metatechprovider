import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../backend/.env", import.meta.url));
const current = await readFile(envPath, "utf8");
const match = current.match(/^CREDENTIALS_ENCRYPTION_KEY="([^"]*)"/m);

if (!match) throw new Error("CREDENTIALS_ENCRYPTION_KEY is missing from backend/.env");
if (match[1]) {
  console.log("CREDENTIALS_ENCRYPTION_KEY is already configured.");
  process.exit(0);
}

const key = randomBytes(32).toString("base64");
const updated = current.replace(
  /^CREDENTIALS_ENCRYPTION_KEY=""/m,
  `CREDENTIALS_ENCRYPTION_KEY="${key}"`,
);
await writeFile(envPath, updated, "utf8");
console.log("Generated CREDENTIALS_ENCRYPTION_KEY in backend/.env.");
