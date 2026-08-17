"use client";

import { useEffect, useState } from "react";
import { WebhookPanel, type WebhookConnection } from "@/components/WebhookPanel";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { ApiError, apiFetch } from "@/lib/api";

export default function WebhooksPage() {
  const [connections, setConnections] = useState<WebhookConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => { let active = true; void apiFetch<{ connections: WebhookConnection[] }>("/api/whatsapp/connections").then((payload) => { if (active) setConnections(payload.connections); }).catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "No fue posible cargar las conexiones."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  function updated(connection: WebhookConnection) { setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, ...connection } : item)); }
  return <div className="workspace-page"><WorkspacePageHeader eyebrow="Enrutamiento inbound" title="Webhooks" description="Configura el destino firmado para n8n, tu CRM o cualquier sistema externo." />{error && <p className="alert alert-error">{error}</p>}{loading ? <div className="workspace-loading-card"><span className="spinner" /> Cargando configuración…</div> : <WebhookPanel connections={connections} onConnectionUpdated={updated} />}</div>;
}
