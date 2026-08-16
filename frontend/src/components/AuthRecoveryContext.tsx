interface AuthRecoveryContextProps {
  mode: "verify" | "forgot" | "reset";
}

const copy = {
  verify: {
    eyebrow: "Activación segura",
    title: "Primero verificamos que el correo sea tuyo.",
    text: "La cuenta permanece aislada y sin acceso al panel hasta que confirmes el enlace enviado a tu bandeja de entrada.",
  },
  forgot: {
    eyebrow: "Recuperación de acceso",
    title: "Recupera tu cuenta sin exponer tus datos.",
    text: "El sistema genera un enlace temporal de un solo uso y nunca revela si una dirección pertenece a una cuenta.",
  },
  reset: {
    eyebrow: "Nueva credencial",
    title: "Cambia tu contraseña y cierra las sesiones anteriores.",
    text: "Al guardar la nueva contraseña invalidaremos el enlace y revocaremos todas las sesiones activas de la cuenta.",
  },
} as const;

export function AuthRecoveryContext({ mode }: AuthRecoveryContextProps) {
  const content = copy[mode];
  return (
    <section className="auth-context">
      <p className="eyebrow">{content.eyebrow}</p>
      <h2>{content.title}</h2>
      <p>{content.text}</p>
      <div className="auth-feature-grid">
        <div><span>◇</span><strong>Token protegido</strong><small>Se guarda únicamente su hash.</small></div>
        <div><span>⌁</span><strong>Uso único</strong><small>El enlace se invalida al consumirlo.</small></div>
        <div><span>◷</span><strong>Caducidad</strong><small>Ventana de uso estrictamente limitada.</small></div>
        <div><span>✓</span><strong>Sin exposición</strong><small>Respuestas diseñadas contra enumeración.</small></div>
      </div>
      <div className="auth-security-note">
        <span>✓</span>
        <p><strong>Credenciales manejadas exclusivamente por el backend</strong><small>Los tokens nunca se almacenan en texto plano en MySQL.</small></p>
      </div>
    </section>
  );
}
