"use client";

import { FormEvent, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";

export function ForgotPasswordForm() {
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setLoading(true);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      const result = await apiFetch<{ message: string }>("/api/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible procesar la solicitud.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Correo electrónico<input name="email" type="email" required autoComplete="email" /></label>
      {message && <p className="alert alert-success" role="status">{message}</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={loading}>
        {loading ? "Enviando…" : "Enviar enlace de recuperación"}
      </button>
    </form>
  );
}
