import type { Metadata } from "next";
import Link from "next/link";
import { AuthRecoveryContext } from "@/components/AuthRecoveryContext";
import { Brand } from "@/components/Brand";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Recuperar contraseña · THagencia",
  referrer: "no-referrer",
};

export default function ForgotPasswordPage() {
  return (
    <main className="auth-shell">
      <div className="auth-side"><Brand /><AuthRecoveryContext mode="forgot" /><p className="auth-side-footer">Recuperación segura · Enlaces de un solo uso</p></div>
      <section className="auth-card">
        <p className="eyebrow">¿No puedes acceder?</p><h1>Recupera tu contraseña.</h1>
        <p>Escribe tu correo y te enviaremos instrucciones si existe una cuenta activa.</p>
        <ForgotPasswordForm />
        <p className="auth-alternative"><Link href="/login">Volver a iniciar sesión</Link></p>
        <p className="auth-legal">El enlace vence en una hora y no modifica tu cuenta hasta que elijas una nueva contraseña.</p>
      </section>
    </main>
  );
}
