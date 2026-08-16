import { randomBytes } from "node:crypto";

export function tenantSlug(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140) || "empresa";

  return `${base}-${randomBytes(3).toString("hex")}`;
}
