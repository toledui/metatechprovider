"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Brand } from "@/components/Brand";
import { ApiKeysPanel } from "@/components/ApiKeysPanel";
import { EmbeddedSignupButton } from "@/components/EmbeddedSignupButton";
import { WebhookPanel, type WebhookConnection } from "@/components/WebhookPanel";
import { ApiError, apiFetch } from "@/lib/api";

interface AuthState {
  user: { id: string; name: string; email: string; role: string; platformRole: string };
  tenant: { id: string; name: string; slug: string };
}

interface Connection extends WebhookConnection {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string;
  coexistenceEnabled: boolean;
  connectedAt?: string | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const loadDashboard = useCallback(async () => {
    try {
      const [authPayload, connectionPayload] = await Promise.all([
        apiFetch<AuthState>("/api/auth/me"),
        apiFetch<{ connections: Connection[] }>("/api/whatsapp/connections"),
      ]);
      setAuth(authPayload);
      setConnections(connectionPayload.connections);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace("/login");
        return;
      }
      setError(caught instanceof Error ? caught.message : "No fue posible cargar el panel.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  async function logout() {
    await apiFetch<void>("/api/auth/logout", { method: "POST", body: "{}" });
    router.replace("/login");
  }

  function connected(connection: Connection) {
    setConnections((current) => [connection, ...current.filter((item) => item.id !== connection.id)]);
  }

  function connectionUpdated(updated: WebhookConnection) {
    setConnections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
  }

  if (loading) return <main className="loading-screen"><span className="spinner" />Cargando panel…</main>;
  if (error) return <main className="loading-screen"><p className="alert alert-error">{error}</p></main>;
  if (!auth) return null;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <Brand />
        <div className="account-menu">
          <span><strong>{auth.user.name}</strong><small>{auth.tenant.name}</small></span>
          {auth.user.platformRole === "SUPERADMIN" && <a className="button button-ghost button-small" href="/superadmin">Superadmin</a>}
          <button className="button button-ghost button-small" type="button" onClick={logout}>Salir</button>
        </div>
      </header>

      <div className="dashboard-grid">
        <aside className="sidebar">
          <p className="sidebar-label">Workspace</p>
          <a className="sidebar-item active" href="#connections"><span>◉</span> Conexiones</a>
          <a className="sidebar-item" href="#webhooks"><span>↗</span> Webhooks <small>Activo</small></a>
          <a className="sidebar-item" href="#api-keys"><span>⌁</span> API Keys <small>Activo</small></a>
        </aside>

        <section className="dashboard-content" id="connections">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Configuración Meta</p>
              <h1>Conexiones de WhatsApp</h1>
              <p>Vincula una línea y autoriza a THagencia como Tech Provider.</p>
            </div>
            <span className="tenant-chip">Tenant · {auth.tenant.slug}</span>
          </div>

          <div className="content-columns">
            <article className="panel onboarding-panel">
              <div className="panel-number">01</div>
              <div className="panel-copy">
                <h2>Embedded Signup</h2>
                <p>Meta abrirá un flujo seguro para elegir el negocio, WABA y número telefónico.</p>
                <EmbeddedSignupButton onConnected={connected} />
              </div>
            </article>

            <article className="panel connections-panel">
              <div className="panel-title-row">
                <div><h2>Líneas vinculadas</h2><p>{connections.length} conexión{connections.length === 1 ? "" : "es"}</p></div>
                <span className="count-badge">{connections.length}</span>
              </div>
              {connections.length === 0 ? (
                <div className="empty-state"><span>＋</span><strong>Aún no hay líneas</strong><p>Completa el onboarding para ver aquí tu conexión.</p></div>
              ) : (
                <div className="connection-list">
                  {connections.map((connection) => (
                    <div className="connection-item" key={connection.id}>
                      <div className="wa-avatar">WA</div>
                      <div className="connection-copy">
                        <strong>{connection.verifiedName ?? "WhatsApp Business"}</strong>
                        <span>{connection.displayPhoneNumber ?? connection.phoneNumberId}</span>
                        <small>WABA {connection.wabaId}</small>
                      </div>
                      <span className="status-badge"><i />{connection.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
          <WebhookPanel connections={connections} onConnectionUpdated={connectionUpdated} />
          <ApiKeysPanel userRole={auth.user.role} exampleConnectionId={connections[0]?.id} />
        </section>
      </div>
    </main>
  );
}
