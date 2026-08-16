"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";

type VerificationState = "waiting" | "verifying" | "verified" | "error";

export function VerifyEmailForm({ token, initialEmail, emailWasSent }: { token?: string; initialEmail?: string; emailWasSent?: boolean }) {
  const requested = useRef(false);
  const [state, setState] = useState<VerificationState>(token ? "verifying" : "waiting");
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || requested.current) return;
    requested.current = true;
    apiFetch<{ message: string }>("/api/auth/email-verification/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    }).then((result) => {
      window.history.replaceState({}, "", "/verify-email");
      setMessage(result.message);
      setState("verified");
    }).catch((caught) => {
      window.history.replaceState({}, "", "/verify-email");
      setMessage(caught instanceof ApiError ? caught.message : "No fue posible verificar el correo.");
      setState("error");
    });
  }, [token]);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      const result = await apiFetch<{ message: string }>("/api/auth/email-verification/resend", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage(result.message);
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : "No fue posible solicitar otro enlace.");
    } finally {
      setLoading(false);
    }
  }

  if (state === "verifying") return <div className="auth-result"><span className="spinner" /><h2>Verificando correo…</h2><p>Estamos validando tu enlace seguro.</p></div>;
  if (state === "verified") return <div className="auth-result"><span>✓</span><h2>Cuenta activada</h2><p>{message}</p><Link className="button button-primary" href="/login">Iniciar sesión</Link></div>;

  return (
    <>
      <p className={`alert ${state === "error" || emailWasSent === false ? "alert-warning" : "alert-success"}`} role="status">
        {message ?? (emailWasSent === false
          ? "La cuenta fue creada, pero no pudimos enviar el correo. Verifica la configuración SMTP y solicita otro enlace."
          : "Te enviamos un enlace de confirmación. Revisa también la carpeta de correo no deseado.")}
      </p>
      <form className="auth-form compact-form" onSubmit={resend}>
        <label>Correo electrónico<input name="email" type="email" required defaultValue={initialEmail} autoComplete="email" /></label>
        <button className="button button-ghost" type="submit" disabled={loading}>{loading ? "Solicitando…" : "Reenviar enlace"}</button>
      </form>
    </>
  );
}
