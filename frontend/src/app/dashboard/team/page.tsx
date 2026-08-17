"use client";

import { TeamPanel } from "@/components/TeamPanel";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { useWorkspace } from "@/components/WorkspaceShell";

export default function TeamPage() {
  const auth = useWorkspace();
  return <div className="workspace-page"><WorkspacePageHeader eyebrow="Personas y permisos" title="Equipo" description="Gestiona accesos individuales, roles e invitaciones de tu organización." action={<span className="workspace-role-chip">Tu rol · {auth.user.role}</span>} /><TeamPanel currentUserId={auth.user.id} currentUserRole={auth.user.role} /></div>;
}
