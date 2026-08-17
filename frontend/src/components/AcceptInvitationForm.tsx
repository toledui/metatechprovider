"use client";

import { FormEvent, useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";

interface InvitationPreview { email: string; role: "ADMIN" | "MEMBER"; tenantName: string; invitedBy: string; expiresAt: string; }

export function AcceptInvitationForm({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitationPreview>();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void apiFetch<{ invitation: InvitationPreview }>(`/api/team/invitations/preview?token=${encodeURIComponent(token)}`).then((payload) => { if (active) setPreview(payload.invitation); }).catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "No fue posible validar la invitación."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(undefined);
    try {
      const payload = await apiFetch<{ redirectTo: string }>("/api/team/invitations/accept", { method: "POST", body: JSON.stringify({ token, name: name.trim(), password }) });
      window.location.assign(payload.redirectTo);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible aceptar la invitación."); setBusy(false);
    }
  }

  if (loading) return <div className="invite-state"><span className="spinner" /> Validando invitación…</div>;
  if (!preview) return <div className="invite-state invite-invalid"><strong>Invitación no disponible</strong><p>{error ?? "El enlace expiró o ya fue utilizado."}</p><a className="button button-ghost" href="/login">Ir al login</a></div>;
  return <form className="auth-form" onSubmit={accept}>
    <div className="invite-summary"><span>Invitación de {preview.invitedBy}</span><strong>{preview.tenantName}</strong><small>Rol: {preview.role === "ADMIN" ? "Admin" : "Member"} · {preview.email}</small></div>
    <label>Tu nombre completo<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={150} autoComplete="name" required /></label>
    <label>Crea una contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" required /><small>Mínimo 12 caracteres.</small></label>
    {error && <p className="alert alert-error" role="alert">{error}</p>}
    <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creando acceso…" : "Aceptar y entrar"}</button>
  </form>;
}
