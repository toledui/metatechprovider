import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthContext } from "@/components/AuthContext";
import { Brand } from "@/components/Brand";
import { getCurrentAuth } from "@/lib/server-auth";

export default async function LoginPage() {
  const auth = await getCurrentAuth();
  if (auth) {
    redirect(auth.user.platformRole === "SUPERADMIN" ? "/superadmin" : "/dashboard");
  }

  return (
    <main className="auth-shell">
      <div className="auth-side">
        <Brand />
        <AuthContext mode="login" />
        <p className="auth-side-footer">THagencia Tech Provider</p>
      </div>
      <section className="auth-card">
        <p className="eyebrow">Panel B2B</p><h1>Bienvenido de vuelta.</h1>
        <p>Accede al panel de tu organización.</p>
        <AuthForm mode="login" />
        <p className="auth-alternative">¿Aún no tienes cuenta? <Link href="/register">Crear una</Link></p>
        <p className="auth-legal">Al acceder aceptas las políticas operativas y de seguridad de la plataforma.</p>
      </section>
    </main>
  );
}
