import type { Metadata } from "next";
import Link from "next/link";
import { AuthRecoveryContext } from "@/components/AuthRecoveryContext";
import { Brand } from "@/components/Brand";
import { VerifyEmailForm } from "@/components/VerifyEmailForm";

export const metadata: Metadata = {
  title: "Confirma tu correo · THagencia",
  referrer: "no-referrer",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;
  const email = typeof params.email === "string" ? params.email : undefined;
  const emailWasSent = params.sent === "1" ? true : params.sent === "0" ? false : undefined;
  return (
    <main className="auth-shell">
      <div className="auth-side"><Brand /><AuthRecoveryContext mode="verify" /><p className="auth-side-footer">Verificación de propiedad · Acceso condicionado</p></div>
      <section className="auth-card">
        <p className="eyebrow">Confirma tu identidad</p><h1>Revisa tu correo.</h1>
        <p>No habilitaremos el panel hasta confirmar que tienes acceso a esta dirección.</p>
        <VerifyEmailForm token={token} initialEmail={email} emailWasSent={emailWasSent} />
        <p className="auth-alternative"><Link href="/login">Volver a iniciar sesión</Link></p>
        <p className="auth-legal">Los enlaces de verificación vencen en 24 horas y solo pueden utilizarse una vez.</p>
      </section>
    </main>
  );
}
