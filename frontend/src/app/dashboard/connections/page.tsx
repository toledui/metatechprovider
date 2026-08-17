"use client";

import { useEffect, useState } from "react";
import { EmbeddedSignupButton } from "@/components/EmbeddedSignupButton";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { ApiError, apiFetch } from "@/lib/api";

interface Connection { id: string; wabaId: string; phoneNumberId: string; displayPhoneNumber: string | null; verifiedName: string | null; status: string; coexistenceEnabled: boolean; webhookUrl: string | null; webhookSecretConfigured: boolean; connectedAt?: string | null; }

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => { let active = true; void apiFetch<{ connections: Connection[] }>("/api/whatsapp/connections").then((payload) => { if (active) setConnections(payload.connections); }).catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "No fue posible cargar las conexiones."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  function connected(connection: Connection) { setConnections((current) => [connection, ...current.filter((item) => item.id !== connection.id)]); }
  return <div className="workspace-page">
    <WorkspacePageHeader eyebrow="WhatsApp Business" title="Conexiones" description="Vincula y supervisa las líneas autorizadas para este workspace." action={<span className="workspace-count-chip">{connections.length} línea{connections.length === 1 ? "" : "s"}</span>} />
    {error && <p className="alert alert-error">{error}</p>}
    <div className="connections-workspace-grid">
      <article className="panel connection-onboarding-card"><div className="card-kicker"><span>01</span> Nueva conexión</div><h2>Embedded Signup</h2><p>Meta abrirá un flujo seguro para elegir negocio, WABA y número telefónico.</p><EmbeddedSignupButton onConnected={connected} /></article>
      <article className="panel connections-directory"><div className="panel-title-row"><div><h2>Líneas vinculadas</h2><p>Activos disponibles en el tenant</p></div><span className="count-badge">{connections.length}</span></div>
        {loading ? <div className="team-loading"><span className="spinner" /> Cargando líneas…</div> : connections.length === 0 ? <div className="empty-state"><span>＋</span><strong>Aún no hay líneas</strong><p>Completa Embedded Signup para crear la primera conexión.</p></div> : <div className="professional-connection-list">{connections.map((connection) => <div className="professional-connection" key={connection.id}><div className="wa-avatar">WA</div><div><strong>{connection.verifiedName ?? "WhatsApp Business"}</strong><span>{connection.displayPhoneNumber ?? connection.phoneNumberId}</span><small>WABA {connection.wabaId}</small></div><span className="status-badge"><i />{connection.status}</span></div>)}</div>}
      </article>
    </div>
  </div>;
}
