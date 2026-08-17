import type { AuthContext } from "../auth/session.js";
import { UserRole } from "../generated/prisma/enums.js";
import { AppError } from "../lib/errors.js";

export const inboxPermissionKeys = [
  "sendMessages",
  "editContacts",
  "assignConversations",
  "changeStatus",
  "manageTags",
  "addNotes",
  "manageTemplates",
] as const;

export type InboxPermission = typeof inboxPermissionKeys[number];
export type InboxPermissions = Record<InboxPermission, boolean>;

const fullAccess: InboxPermissions = {
  sendMessages: true,
  editContacts: true,
  assignConversations: true,
  changeStatus: true,
  manageTags: true,
  addNotes: true,
  manageTemplates: true,
};

const memberDefaults: InboxPermissions = {
  sendMessages: true,
  editContacts: false,
  assignConversations: false,
  changeStatus: true,
  manageTags: false,
  addNotes: true,
  manageTemplates: false,
};

export function resolveInboxPermissions(role: string, stored: unknown): InboxPermissions {
  if (role === UserRole.OWNER || role === UserRole.ADMIN) return { ...fullAccess };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { ...memberDefaults };
  const source = stored as Record<string, unknown>;
  return Object.fromEntries(inboxPermissionKeys.map((key) => [
    key,
    typeof source[key] === "boolean" ? source[key] : memberDefaults[key],
  ])) as InboxPermissions;
}

export function requireInboxPermission(
  auth: AuthContext,
  permission: InboxPermission,
  stored: unknown,
): void {
  if (!resolveInboxPermissions(auth.userRole, stored)[permission]) {
    throw new AppError(403, "inbox_permission_required", "Tu cuenta no tiene permiso para realizar esta acción.", { permission });
  }
}
