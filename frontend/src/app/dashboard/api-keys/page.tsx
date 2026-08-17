"use client";

import { useEffect, useState } from "react";
import { ApiKeysPanel } from "@/components/ApiKeysPanel";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { useWorkspace } from "@/components/WorkspaceShell";
import { apiFetch } from "@/lib/api";

export default function ApiKeysPage() {
  const auth = useWorkspace();
  const [connectionId, setConnectionId] = useState<string>();
  useEffect(() => { void apiFetch<{ connections: Array<{ id: string }> }>("/api/whatsapp/connections").then((payload) => setConnectionId(payload.connections[0]?.id)).catch(() => undefined); }, []);
  return <div className="workspace-page"><WorkspacePageHeader eyebrow="Acceso programático" title="API Keys" description="Administra credenciales para n8n, CRMs y servicios externos sin exponer tokens de Meta." action={<span className="workspace-scope-chip">messages:send</span>} /><ApiKeysPanel userRole={auth.user.role} exampleConnectionId={connectionId} /></div>;
}
