"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext } from "react";

import { Brand } from "@/components/Brand";
import { apiFetch } from "@/lib/api";
import type { ServerAuthState } from "@/lib/server-auth";

const WorkspaceContext = createContext<ServerAuthState | null>(null);

export function useWorkspace(): ServerAuthState {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceShell no está disponible.");
  return value;
}

const navigation = [
  { href: "/dashboard", label: "Resumen", icon: "overview" },
  { href: "/dashboard/inbox", label: "Inbox", icon: "inbox" },
  { href: "/dashboard/connections", label: "Conexiones", icon: "connections" },
  { href: "/dashboard/webhooks", label: "Webhooks", icon: "webhooks" },
  { href: "/dashboard/api-keys", label: "API Keys", icon: "keys" },
  { href: "/dashboard/team", label: "Equipo", icon: "team" },
] as const;

export function WorkspaceShell({ auth, children }: { auth: ServerAuthState; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch<void>("/api/auth/logout", { method: "POST", body: "{}" });
    router.replace("/login");
  }

  return <WorkspaceContext.Provider value={auth}>
    <main className="workspace-shell">
      <header className="workspace-header">
        <Brand />
        <div className="workspace-account">
          <span className="workspace-tenant-name">{auth.tenant.name}</span>
          <div className="workspace-user-avatar">{auth.user.name.slice(0, 2).toUpperCase()}</div>
          <div className="workspace-user-copy"><strong>{auth.user.name}</strong><small>{auth.user.role}</small></div>
          {auth.user.platformRole === "SUPERADMIN" && <Link className="button button-ghost button-small" href="/superadmin">Superadmin</Link>}
          <button className="workspace-logout" type="button" onClick={() => void logout()} aria-label="Cerrar sesión"><NavIcon name="logout" /></button>
        </div>
      </header>
      <div className="workspace-layout">
        <aside className="workspace-sidebar">
          <div className="workspace-identity"><span>Workspace</span><strong>{auth.tenant.name}</strong><small>{auth.tenant.slug}</small></div>
          <nav className="workspace-nav" aria-label="Navegación del workspace">
            <p>Operación</p>
            {navigation.map((item) => {
              const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
              return <Link className={`workspace-nav-item ${active ? "active" : ""}`} href={item.href} key={item.href}><NavIcon name={item.icon} /><span>{item.label}</span>{active && <i />}</Link>;
            })}
          </nav>
          <div className="workspace-sidebar-status"><span className="status-dot" /><div><strong>Gateway operativo</strong><small>Meta Graph API v26.0</small></div></div>
        </aside>
        <div className="workspace-body">
          <nav className="workspace-mobile-nav" aria-label="Navegación móvil">
            {navigation.map((item) => {
              const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
              return <Link className={active ? "active" : ""} href={item.href} key={item.href}><NavIcon name={item.icon} /><span>{item.label}</span></Link>;
            })}
          </nav>
          <section className="workspace-content">{children}</section>
        </div>
      </div>
    </main>
  </WorkspaceContext.Provider>;
}

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    inbox: <><path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10"/><path d="M3 15h5l2 3h4l2-3h5"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></>,
    connections: <><path d="M8 12h8"/><path d="M12 8v8"/><circle cx="12" cy="12" r="9"/></>,
    webhooks: <><path d="M8.5 7.5 5 11l3.5 3.5"/><path d="m15.5 7.5 3.5 3.5-3.5 3.5"/><path d="m14 4-4 14"/></>,
    keys: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8"/><path d="m16 7 2 2"/><path d="m14 9 2 2"/></>,
    team: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    logout: <><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
