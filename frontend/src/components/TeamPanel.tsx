"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

type TeamRole = "OWNER" | "ADMIN" | "MEMBER";
type PermissionKey = "sendMessages" | "editContacts" | "assignConversations" | "changeStatus" | "manageTags" | "addNotes" | "manageTemplates";
type InboxPermissions = Record<PermissionKey, boolean>;

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  inboxPermissions: InboxPermissions;
}

interface TeamInvitation {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}
interface InboxTeam { id: string; name: string; color: string; members: Array<{ id: string; name: string }> }

interface TeamPanelProps {
  currentUserId: string;
  currentUserRole: string;
}

const roleLabels: Record<TeamRole, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };
const permissionLabels: Record<PermissionKey, string> = { sendMessages: "Enviar mensajes", editContacts: "Editar contactos", assignConversations: "Asignar conversaciones", changeStatus: "Cambiar estados", manageTags: "Gestionar etiquetas", addNotes: "Agregar notas", manageTemplates: "Administrar plantillas" };

export function TeamPanel({ currentUserId, currentUserRole }: TeamPanelProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [inboxTeams, setInboxTeams] = useState<InboxTeam[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamColor, setNewTeamColor] = useState("#ff6b35");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const canManage = currentUserRole === "OWNER" || currentUserRole === "ADMIN";
  const isOwner = currentUserRole === "OWNER";

  const loadTeam = useCallback(async () => {
    try {
      const payload = await apiFetch<{ members: TeamMember[]; invitations: TeamInvitation[]; inboxTeams: InboxTeam[] }>("/api/team");
      setMembers(payload.members);
      setInvitations(payload.invitations);
      setInboxTeams(payload.inboxTeams);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible cargar el equipo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTeam(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTeam]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const payload = await apiFetch<{ invitation: TeamInvitation }>("/api/team/invitations", {
        method: "POST", body: JSON.stringify({ email: email.trim(), role }),
      });
      setInvitations((current) => [payload.invitation, ...current.filter((item) => !(item.email === payload.invitation.email && item.status === "PENDING"))]);
      setEmail("");
      setMessage("Invitación enviada. El enlace será válido durante 72 horas.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible enviar la invitación.");
    } finally { setBusy(false); }
  }

  async function changeRole(member: TeamMember, nextRole: "ADMIN" | "MEMBER") {
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const payload = await apiFetch<{ member: TeamMember }>(`/api/team/members/${member.id}/role`, {
        method: "PATCH", body: JSON.stringify({ role: nextRole }),
      });
      setMembers((current) => current.map((item) => item.id === member.id ? payload.member : item));
      setMessage(`Rol de ${member.name} actualizado.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible cambiar el rol.");
    } finally { setBusy(false); }
  }

  async function removeMember(member: TeamMember) {
    if (!window.confirm(`¿Retirar a ${member.name} del equipo? Su sesión se cerrará inmediatamente.`)) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      await apiFetch<void>(`/api/team/members/${member.id}`, { method: "DELETE" });
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setMessage(`${member.name} fue retirado del equipo.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible retirar al miembro.");
    } finally { setBusy(false); }
  }

  async function revokeInvitation(invitation: TeamInvitation) {
    if (!window.confirm(`¿Revocar la invitación para ${invitation.email}?`)) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      await apiFetch<void>(`/api/team/invitations/${invitation.id}`, { method: "DELETE" });
      setInvitations((current) => current.map((item) => item.id === invitation.id ? { ...item, status: "REVOKED" } : item));
      setMessage("Invitación revocada.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible revocar la invitación.");
    } finally { setBusy(false); }
  }

  async function transferOwnership(member: TeamMember) {
    if (!window.confirm(`¿Transferir la propiedad a ${member.name}? Tu rol cambiará a Admin.`)) return;
    setBusy(true); setError(undefined);
    try {
      await apiFetch<{ transferred: boolean }>("/api/team/ownership/transfer", {
        method: "POST", body: JSON.stringify({ newOwnerId: member.id }),
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible transferir la propiedad.");
      setBusy(false);
    }
  }

  async function updatePermission(member: TeamMember, key: PermissionKey, enabled: boolean) {
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const response = await apiFetch<{ member: TeamMember }>(`/api/team/members/${member.id}/inbox-permissions`, {
        method: "PATCH", body: JSON.stringify({ ...member.inboxPermissions, [key]: enabled }),
      });
      setMembers((current) => current.map((item) => item.id === member.id ? response.member : item));
      setMessage(`Permisos de ${member.name} actualizados.`);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "No fue posible actualizar los permisos."); }
    finally { setBusy(false); }
  }

  async function createInboxTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const response = await apiFetch<{ team: InboxTeam }>("/api/team/groups", { method: "POST", body: JSON.stringify({ name: newTeamName.trim(), color: newTeamColor }) });
      setInboxTeams((current) => [...current, response.team].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTeamName("");
      setMessage("Equipo operativo creado.");
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "No fue posible crear el equipo."); }
    finally { setBusy(false); }
  }

  async function toggleTeamMember(team: InboxTeam, userId: string, enabled: boolean) {
    const userIds = enabled ? [...team.members.map((member) => member.id), userId] : team.members.map((member) => member.id).filter((id) => id !== userId);
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const response = await apiFetch<{ members: InboxTeam["members"] }>(`/api/team/groups/${team.id}/members`, { method: "PUT", body: JSON.stringify({ userIds }) });
      setInboxTeams((current) => current.map((item) => item.id === team.id ? { ...item, members: response.members } : item));
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "No fue posible actualizar el equipo."); }
    finally { setBusy(false); }
  }

  async function deleteInboxTeam(team: InboxTeam) {
    if (!window.confirm(`¿Eliminar el equipo ${team.name}? Las asignaciones activas se cerrarán.`)) return;
    setBusy(true); setError(undefined);
    try {
      await apiFetch(`/api/team/groups/${team.id}`, { method: "DELETE" });
      setInboxTeams((current) => current.filter((item) => item.id !== team.id));
      setMessage("Equipo eliminado.");
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "No fue posible eliminar el equipo."); }
    finally { setBusy(false); }
  }

  const pendingInvitations = invitations.filter((item) => item.status === "PENDING");

  return (
    <section className="dedicated-module team-module">
      <div className="team-grid">
        <article className="panel team-invite-card">
          <div className="panel-title-row"><div><h2>Invitar usuario</h2><p>Acceso individual y auditable</p></div><span className="count-badge">＋</span></div>
          <form className="webhook-form" onSubmit={invite}>
            <label>Correo electrónico<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={191} placeholder="agente@empresa.com" disabled={!canManage || busy} required /></label>
            <label>Rol inicial<select value={role} onChange={(event) => setRole(event.target.value as "ADMIN" | "MEMBER")} disabled={!canManage || busy}><option value="MEMBER">Member · operación diaria</option><option value="ADMIN">Admin · configuración y equipo</option></select><small>El rol Owner solo se asigna mediante transferencia de propiedad.</small></label>
            {message && <p className="alert alert-success" role="status">{message}</p>}
            {error && <p className="alert alert-error" role="alert">{error}</p>}
            {!canManage && <p className="alert">Tu rol tiene acceso de lectura al equipo.</p>}
            <button className="button button-primary" type="submit" disabled={!canManage || busy}>{busy ? "Procesando…" : "Enviar invitación"}</button>
          </form>
        </article>
        <article className="panel team-members-card">
          <div className="panel-title-row"><div><h2>Miembros activos</h2><p>Roles y acceso al workspace</p></div><span className="count-badge">{members.length}</span></div>
          {loading ? <div className="team-loading"><span className="spinner" /> Cargando equipo…</div> : <div className="team-member-list">
            {members.map((member) => {
              const canRemove = canManage && member.id !== currentUserId && member.role !== "OWNER" && (isOwner || member.role === "MEMBER");
              return <div className="team-member" key={member.id}>
                <span className="team-avatar">{member.name.slice(0, 2).toUpperCase()}</span>
                <div className="team-member-copy"><strong>{member.name}{member.id === currentUserId ? " · Tú" : ""}</strong><span>{member.email}</span><small>{member.lastLoginAt ? `Último acceso ${new Date(member.lastLoginAt).toLocaleString("es-MX")}` : "Sin accesos registrados"}</small></div>
                {isOwner && member.role !== "OWNER" ? <select className="team-role-select" aria-label={`Rol de ${member.name}`} value={member.role} disabled={busy} onChange={(event) => void changeRole(member, event.target.value as "ADMIN" | "MEMBER")}><option value="ADMIN">Admin</option><option value="MEMBER">Member</option></select> : <span className={`role-badge role-${member.role.toLowerCase()}`}>{roleLabels[member.role]}</span>}
                <div className="team-member-actions">{isOwner && member.role !== "OWNER" && <button className="button button-ghost button-tiny" type="button" disabled={busy} onClick={() => void transferOwnership(member)}>Hacer owner</button>}{canRemove && <button className="button button-danger button-tiny" type="button" disabled={busy} onClick={() => void removeMember(member)}>Retirar</button>}</div>
                {member.role === "MEMBER" && <details className="member-permissions"><summary>Permisos del inbox</summary><div>{(Object.keys(permissionLabels) as PermissionKey[]).map((key) => <label key={key}><input type="checkbox" checked={member.inboxPermissions[key]} disabled={!canManage || busy} onChange={(event) => void updatePermission(member, key, event.target.checked)} />{permissionLabels[key]}</label>)}</div></details>}
              </div>;
            })}
          </div>}
        </article>
      </div>
      <article className="panel inbox-teams-card">
        <div className="panel-title-row"><div><h2>Equipos del inbox</h2><p>Catálogo durable y membresías para asignación</p></div><span className="count-badge">{inboxTeams.length}</span></div>
        {canManage && <form className="inbox-team-create" onSubmit={createInboxTeam}><input value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} placeholder="Ej. Ventas" maxLength={100} required /><input type="color" value={newTeamColor} onChange={(event) => setNewTeamColor(event.target.value)} /><button className="button button-secondary button-small" type="submit" disabled={busy}>Crear equipo</button></form>}
        <div className="inbox-team-catalog">{inboxTeams.map((team) => <section key={team.id}><header><i style={{ background: team.color }} /><strong>{team.name}</strong>{canManage && <button type="button" onClick={() => void deleteInboxTeam(team)}>Eliminar</button>}</header><div>{members.filter((member) => member.status === "ACTIVE").map((member) => <label key={member.id}><input type="checkbox" checked={team.members.some((item) => item.id === member.id)} disabled={!canManage || busy} onChange={(event) => void toggleTeamMember(team, member.id, event.target.checked)} />{member.name}</label>)}</div></section>)}{inboxTeams.length === 0 && <p className="team-empty">Crea el primer equipo para asignar conversaciones.</p>}</div>
      </article>
      <article className="panel invitations-card">
        <div className="panel-title-row"><div><h2>Invitaciones</h2><p>{pendingInvitations.length} pendiente{pendingInvitations.length === 1 ? "" : "s"}</p></div><span className="count-badge">{pendingInvitations.length}</span></div>
        {invitations.length === 0 ? <div className="team-empty"><span>✉</span><p>No hay invitaciones registradas.</p></div> : <div className="invitation-list">{invitations.map((invitation) => <div className="invitation-item" key={invitation.id}><div><strong>{invitation.email}</strong><span>{roleLabels[invitation.role]} · Invitó {invitation.invitedBy}</span><small>Creada {new Date(invitation.createdAt).toLocaleString("es-MX")}</small></div><span className={`invitation-status invitation-${invitation.status.toLowerCase()}`}>{invitation.status}</span>{invitation.status === "PENDING" && canManage && <button className="button button-ghost button-tiny" type="button" disabled={busy} onClick={() => void revokeInvitation(invitation)}>Revocar</button>}</div>)}</div>}
      </article>
    </section>
  );
}
