import { AcceptInvitationForm } from "@/components/AcceptInvitationForm";
import { Brand } from "@/components/Brand";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <main className="auth-page"><div className="auth-shell invite-shell">
    <section className="auth-side"><Brand /><div className="auth-context"><p className="eyebrow">Colaboración segura</p><h2>Tu acceso personal al workspace.</h2><p>Acepta la invitación para trabajar con conversaciones, conexiones e integraciones sin compartir contraseñas.</p><div className="auth-security-note"><span>✓</span><p><strong>Acceso trazable por usuario</strong><small>Las acciones y cambios de permisos quedan asociados a tu cuenta.</small></p></div></div></section>
    <section className="auth-card"><p className="eyebrow">Invitación de equipo</p><h1>Activa tu acceso</h1><p className="auth-card-intro">Confirma tus datos para unirte a la organización.</p>{token ? <AcceptInvitationForm token={token} /> : <div className="invite-state invite-invalid"><strong>Falta el token</strong><p>Solicita una nueva invitación al administrador del tenant.</p><a className="button button-ghost" href="/login">Ir al login</a></div>}</section>
  </div></main>;
}
