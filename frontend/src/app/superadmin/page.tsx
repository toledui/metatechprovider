"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Brand } from "@/components/Brand";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ApiError, apiFetch } from "@/lib/api";

type Section = "overview" | "tenants" | "users" | "connections" | "settings";
type TenantStatus = "ONBOARDING" | "ACTIVE" | "SUSPENDED";

interface AuthState {
  user: { name: string; email: string; platformRole: string };
  tenant: { name: string };
}

interface Metrics {
  tenants: number;
  activeTenants: number;
  users: number;
  connections: number;
  activeConnections: number;
  failedWebhooks: number;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  users: number;
  connections: number;
  createdAt: string;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  platformRole: string;
  status: string;
  tenant: { name: string };
  lastLoginAt: string | null;
}

interface AdminConnection {
  id: string;
  tenant: { name: string };
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string;
  coexistenceEnabled: boolean;
}

export default function SuperadminPage() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("overview");
  const [auth, setAuth] = useState<AuthState>();
  const [metrics, setMetrics] = useState<Metrics>();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [connections, setConnections] = useState<AdminConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [updatingTenant, setUpdatingTenant] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [authData, overviewData, tenantsData, usersData, connectionsData] = await Promise.all([
        apiFetch<AuthState>("/api/auth/me"),
        apiFetch<{ metrics: Metrics }>("/api/admin/overview"),
        apiFetch<{ tenants: Tenant[] }>("/api/admin/tenants"),
        apiFetch<{ users: AdminUser[] }>("/api/admin/users"),
        apiFetch<{ connections: AdminConnection[] }>("/api/admin/connections"),
      ]);
      if (authData.user.platformRole !== "SUPERADMIN") {
        router.replace("/dashboard");
        return;
      }
      setAuth(authData);
      setMetrics(overviewData.metrics);
      setTenants(tenantsData.tenants);
      setUsers(usersData.users);
      setConnections(connectionsData.connections);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace("/login");
        return;
      }
      if (caught instanceof ApiError && caught.status === 403) {
        router.replace("/dashboard");
        return;
      }
      setError(caught instanceof Error ? caught.message : "No fue posible cargar el panel global.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function changeTenantStatus(tenantId: string, status: TenantStatus) {
    setUpdatingTenant(tenantId);
    setError(undefined);
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setTenants((current) => current.map((tenant) => tenant.id === tenantId ? { ...tenant, status } : tenant));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible actualizar el tenant.");
    } finally {
      setUpdatingTenant(undefined);
    }
  }

  async function logout() {
    await apiFetch<void>("/api/auth/logout", { method: "POST", body: "{}" });
    router.replace("/login");
  }

  if (loading) return <main className="loading-screen"><span className="spinner" />Cargando Superadmin…</main>;
  if (!auth || !metrics) return <main className="loading-screen"><p className="alert alert-error">{error ?? "Acceso no disponible."}</p></main>;

  const navigation: Array<{ id: Section; label: string; count?: number }> = [
    { id: "overview", label: "Resumen" },
    { id: "tenants", label: "Tenants", count: tenants.length },
    { id: "users", label: "Usuarios", count: users.length },
    { id: "connections", label: "Conexiones", count: connections.length },
    { id: "settings", label: "Settings" },
  ];

  return (
    <main className="admin-shell">
      <header className="dashboard-header admin-header">
        <Brand />
        <div className="account-menu">
          <span><strong>{auth.user.name}</strong><small>Control global</small></span>
          <a className="button button-ghost button-small" href="/dashboard">Panel cliente</a>
          <button className="button button-ghost button-small" type="button" onClick={logout}>Salir</button>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-badge"><span>TH</span><div><strong>Superadmin</strong><small>Platform control</small></div></div>
          <nav>
            {navigation.map((item) => (
              <button className={`admin-nav-item ${section === item.id ? "active" : ""}`} type="button" key={item.id} onClick={() => setSection(item.id)}>
                {item.label}{item.count !== undefined && <small>{item.count}</small>}
              </button>
            ))}
          </nav>
          <div className="admin-sidebar-footer"><span className="status-dot" /> Sistema operativo</div>
        </aside>

        <section className="admin-content">
          <div className="section-heading admin-title">
            <div><p className="eyebrow">THagencia Platform</p><h1>{navigation.find((item) => item.id === section)?.label}</h1><p>Visibilidad y control de toda la plataforma multitenant.</p></div>
            <span className="superadmin-chip">Superadmin</span>
          </div>
          {error && <p className="alert alert-error">{error}</p>}

          {section === "overview" && (
            <>
              <div className="metrics-grid">
                <Metric label="Tenants" value={metrics.tenants} detail={`${metrics.activeTenants} activos`} />
                <Metric label="Usuarios" value={metrics.users} detail="En toda la plataforma" />
                <Metric label="Conexiones" value={metrics.connections} detail={`${metrics.activeConnections} activas`} />
                <Metric label="Webhooks fallidos" value={metrics.failedWebhooks} detail="Requieren atención" warning={metrics.failedWebhooks > 0} />
              </div>
              <AdminTable title="Tenants recientes" subtitle="Últimas organizaciones registradas">
                <TenantRows tenants={tenants.slice(0, 8)} updatingTenant={updatingTenant} onStatusChange={changeTenantStatus} />
              </AdminTable>
            </>
          )}

          {section === "tenants" && <AdminTable title="Todos los tenants" subtitle="Organizaciones y estado de acceso"><TenantRows tenants={tenants} updatingTenant={updatingTenant} onStatusChange={changeTenantStatus} /></AdminTable>}

          {section === "users" && (
            <AdminTable title="Usuarios" subtitle="Miembros registrados en todos los tenants">
              <table><thead><tr><th>Usuario</th><th>Tenant</th><th>Rol</th><th>Plataforma</th><th>Estado</th></tr></thead><tbody>
                {users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.tenant.name}</td><td>{user.role}</td><td><span className={user.platformRole === "SUPERADMIN" ? "admin-role" : "muted-value"}>{user.platformRole}</span></td><td><span className="table-status"><i />{user.status}</span></td></tr>)}
              </tbody></table>
            </AdminTable>
          )}

          {section === "connections" && (
            <AdminTable title="Conexiones WhatsApp" subtitle="WABAs y números de todos los tenants">
              <table><thead><tr><th>Línea</th><th>Tenant</th><th>WABA ID</th><th>Coexistence</th><th>Estado</th></tr></thead><tbody>
                {connections.length === 0 ? <tr><td colSpan={5} className="table-empty">No hay conexiones vinculadas.</td></tr> : connections.map((connection) => <tr key={connection.id}><td><strong>{connection.verifiedName ?? "WhatsApp Business"}</strong><small>{connection.displayPhoneNumber ?? connection.phoneNumberId}</small></td><td>{connection.tenant.name}</td><td className="mono-value">{connection.wabaId}</td><td>{connection.coexistenceEnabled ? "Sí" : "No"}</td><td><span className="table-status"><i />{connection.status}</span></td></tr>)}
              </tbody></table>
            </AdminTable>
          )}

          {section === "settings" && <SettingsPanel />}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, detail, warning = false }: { label: string; value: number; detail: string; warning?: boolean }) {
  return <article className={`metric-card ${warning ? "warning" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function AdminTable({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <article className="admin-table-card"><div className="admin-table-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div><div className="table-scroll">{children}</div></article>;
}

function TenantRows({ tenants, updatingTenant, onStatusChange }: { tenants: Tenant[]; updatingTenant?: string; onStatusChange(id: string, status: TenantStatus): void }) {
  return <table><thead><tr><th>Organización</th><th>Usuarios</th><th>Conexiones</th><th>Alta</th><th>Estado</th></tr></thead><tbody>
    {tenants.map((tenant) => <tr key={tenant.id}><td><strong>{tenant.name}</strong><small>{tenant.slug}</small></td><td>{tenant.users}</td><td>{tenant.connections}</td><td>{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(tenant.createdAt))}</td><td><select className={`status-select status-${tenant.status.toLowerCase()}`} value={tenant.status} disabled={updatingTenant === tenant.id} onChange={(event) => onStatusChange(tenant.id, event.target.value as TenantStatus)}><option value="ONBOARDING">Onboarding</option><option value="ACTIVE">Activo</option><option value="SUSPENDED">Suspendido</option></select></td></tr>)}
  </tbody></table>;
}
