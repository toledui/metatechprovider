"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";

export function ResetPasswordForm({ token }: { token?: string }) {
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (!token) {
      setError("El enlace de recuperación no contiene un token válido.");
      return;
    }

    setLoading(true);
    try {
      await apiFetch("/api/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      window.history.replaceState({}, "", "/reset-password");
      setComplete(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible cambiar la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  if (complete) {
    return <div className="auth-result"><span>✓</span><h2>Contraseña actualizada</h2><p>Tus sesiones anteriores fueron cerradas. Ya puedes ingresar con tu nueva contraseña.</p><Link className="button button-primary" href="/login">Ir a iniciar sesión</Link></div>;
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Nueva contraseña<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /><small>Mínimo 12 caracteres.</small></label>
      <label>Confirma la contraseña<input name="passwordConfirmation" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /></label>
      {!token && <p className="alert alert-error" role="alert">Este enlace no es válido. Solicita uno nuevo.</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={loading || !token}>{loading ? "Guardando…" : "Guardar nueva contraseña"}</button>
    </form>
  );
}
