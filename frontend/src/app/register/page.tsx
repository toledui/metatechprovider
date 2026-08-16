import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { AuthContext } from "@/components/AuthContext";
import { Brand } from "@/components/Brand";

export default function RegisterPage() {
  return (
    <main className="auth-shell">
      <div className="auth-side">
        <Brand />
        <AuthContext mode="register" />
        <p className="auth-side-footer">Onboarding seguro · Sin compartir tokens con el navegador</p>
      </div>
      <section className="auth-card">
        <p className="eyebrow">Nuevo tenant</p><h1>Crea tu espacio.</h1>
        <p>Primero confirmarás tu correo; después podrás vincular tu línea mediante Embedded Signup.</p>
        <AuthForm mode="register" />
        <p className="auth-alternative">¿Ya tienes cuenta? <Link href="/login">Iniciar sesión</Link></p>
        <p className="auth-legal">Tu organización y sus conexiones se crean en un entorno multitenant aislado.</p>
      </section>
    </main>
  );
}
