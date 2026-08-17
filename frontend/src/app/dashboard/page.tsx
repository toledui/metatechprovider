"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { useWorkspace } from "@/components/WorkspaceShell";
import { apiFetch } from "@/lib/api";

interface OverviewData { connections: number; activeConnections: number; members: number; apiKeys: number; pendingInvitations: number; }

export default function DashboardOverviewPage() {
  const auth = useWorkspace();
  const [data, setData] = useState<OverviewData>();
  useEffect(() => {
    let active = true;
    void Promise.all([
      apiFetch<{ connections: Array<{ status: string }> }>("/api/whatsapp/connections"),
      apiFetch<{ members: unknown[]; invitations: Array<{ status: string }> }>("/api/team"),
      apiFetch<{ apiKeys: Array<{ status: string }> }>("/api/api-keys"),
    ]).then(([connections, team, keys]) => {
      if (active) setData({ connections: connections.connections.length, activeConnections: connections.connections.filter((item) => item.status === "ACTIVE").length, members: team.members.length, pendingInvitations: team.invitations.filter((item) => item.status === "PENDING").length, apiKeys: keys.apiKeys.filter((item) => item.status === "ACTIVE").length });
    }).catch(() => { if (active) setData({ connections: 0, activeConnections: 0, members: 0, pendingInvitations: 0, apiKeys: 0 }); });
    return () => { active = false; };
  }, []);

  return <div className="workspace-page">
    <WorkspacePageHeader eyebrow="Centro de operación" title={`Hola, ${auth.user.name.split(" ")[0]}`} description="Supervisa la infraestructura de WhatsApp de tu organización desde un solo lugar." />
    <div className="workspace-metrics">
      <OverviewMetric label="Líneas conectadas" value={data?.connections} detail={`${data?.activeConnections ?? 0} activas`} tone="orange" />
      <OverviewMetric label="Miembros" value={data?.members} detail={`${data?.pendingInvitations ?? 0} invitaciones pendientes`} />
      <OverviewMetric label="API Keys activas" value={data?.apiKeys} detail="Integraciones autorizadas" />
      <OverviewMetric label="Estado del gateway" value="Operativo" detail="Recepción y envío disponibles" tone="green" />
    </div>
    <div className="workspace-overview-grid">
      <article className="workspace-feature-card feature-primary"><div className="feature-card-icon">WA</div><p className="eyebrow">Primer paso</p><h2>Conecta tu línea de WhatsApp</h2><p>Completa Embedded Signup para habilitar webhooks, mensajes y automatizaciones del tenant.</p><Link className="button button-primary" href="/dashboard/connections">Administrar conexiones</Link></article>
      <article className="workspace-quick-card"><div><span>01</span><div><strong>Configura el enrutamiento</strong><small>Envía eventos firmados a n8n o tu CRM.</small></div></div><Link href="/dashboard/webhooks">Abrir Webhooks <b>→</b></Link></article>
      <article className="workspace-quick-card"><div><span>02</span><div><strong>Autoriza integraciones</strong><small>Crea credenciales aisladas para cada sistema.</small></div></div><Link href="/dashboard/api-keys">Gestionar API Keys <b>→</b></Link></article>
      <article className="workspace-quick-card"><div><span>03</span><div><strong>Invita a tu equipo</strong><small>Define roles individuales y accesos auditables.</small></div></div><Link href="/dashboard/team">Administrar equipo <b>→</b></Link></article>
    </div>
  </div>;
}

function OverviewMetric({ label, value, detail, tone }: { label: string; value: number | string | undefined; detail: string; tone?: string }) {
  return <article className={`workspace-metric ${tone ? `metric-${tone}` : ""}`}><span>{label}</span><strong>{value ?? "—"}</strong><small>{detail}</small></article>;
}
