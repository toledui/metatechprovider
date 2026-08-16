"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

interface AuthFormProps {
  mode: "login" | "register";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      if (mode === "register") {
        const registration = await apiFetch<{
          email: string;
          emailSent: boolean;
          requiresEmailVerification: true;
        }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        router.replace(
          `/verify-email?email=${encodeURIComponent(registration.email)}&sent=${registration.emailSent ? "1" : "0"}`,
        );
        return;
      }

      const auth = await apiFetch<{ user: { platformRole: string } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      router.replace(auth.user.platformRole === "SUPERADMIN" ? "/superadmin" : "/dashboard");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible completar la solicitud.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" method="post" onSubmit={submit}>
      {mode === "register" && (
        <>
          <label>
            Empresa
            <input name="organizationName" minLength={2} maxLength={150} required autoComplete="organization" />
          </label>
          <label>
            Tu nombre
            <input name="name" minLength={2} maxLength={150} required autoComplete="name" />
          </label>
        </>
      )}
      <label>
        Correo electrónico
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Contraseña
        <input
          name="password"
          type="password"
          minLength={mode === "register" ? 12 : 1}
          maxLength={128}
          required
          autoComplete={mode === "register" ? "new-password" : "current-password"}
        />
        {mode === "register" && <small>Mínimo 12 caracteres.</small>}
      </label>
      {mode === "login" && <Link className="auth-help-link" href="/forgot-password">¿Olvidaste tu contraseña?</Link>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={loading || !hydrated}>
        {!hydrated ? "Cargando formulario…" : loading ? "Procesando…" : mode === "register" ? "Crear cuenta" : "Iniciar sesión"}
      </button>
      <noscript><p className="alert alert-error">Activa JavaScript para iniciar sesión de forma segura.</p></noscript>
    </form>
  );
}
