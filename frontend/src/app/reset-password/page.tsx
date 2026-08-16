import type { Metadata } from "next";
import Link from "next/link";
import { AuthRecoveryContext } from "@/components/AuthRecoveryContext";
import { Brand } from "@/components/Brand";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Nueva contraseña · THagencia",
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;
  return (
    <main className="auth-shell">
      <div className="auth-side"><Brand /><AuthRecoveryContext mode="reset" /><p className="auth-side-footer">Cambio seguro · Revocación automática de sesiones</p></div>
      <section className="auth-card">
        <p className="eyebrow">Protege tu cuenta</p><h1>Crea una nueva contraseña.</h1>
        <p>Usa al menos 12 caracteres y evita reutilizar una contraseña anterior.</p>
        <ResetPasswordForm token={token} />
        <p className="auth-alternative"><Link href="/forgot-password">Solicitar otro enlace</Link></p>
      </section>
    </main>
  );
}
