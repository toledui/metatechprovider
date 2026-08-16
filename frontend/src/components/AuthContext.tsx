interface AuthContextProps {
  mode: "login" | "register";
}

export function AuthContext({ mode }: AuthContextProps) {
  const isRegister = mode === "register";

  return (
    <section className="auth-context">
      <p className="eyebrow">{isRegister ? "Tu infraestructura empieza aquí" : "Control operativo unificado"}</p>
      <h2>{isRegister ? "Conecta Meta. Integra tus flujos. Escala con control." : "Toda tu operación de WhatsApp, en un solo lugar."}</h2>
      <p>
        {isRegister
          ? "Crea el espacio de tu empresa y prepara una conexión segura entre WhatsApp Business, n8n y tu CRM."
          : "Gestiona conexiones, credenciales y configuraciones de tu organización desde un panel aislado y seguro."}
      </p>

      {isRegister ? (
        <ol className="auth-steps">
          <li><span>01</span><div><strong>Crea tu organización</strong><small>Un tenant independiente para tu equipo y activos.</small></div></li>
          <li><span>02</span><div><strong>Vincula WhatsApp</strong><small>Embedded Signup con soporte para Coexistence.</small></div></li>
          <li><span>03</span><div><strong>Conecta tu ecosistema</strong><small>n8n, CRMs y servicios externos mediante un gateway único.</small></div></li>
        </ol>
      ) : (
        <div className="auth-feature-grid">
          <div><span>↗</span><strong>Gateway central</strong><small>Meta, n8n y CRM conectados.</small></div>
          <div><span>◇</span><strong>Credenciales seguras</strong><small>Secretos cifrados y aislados.</small></div>
          <div><span>◎</span><strong>Multitenant real</strong><small>Datos separados por empresa.</small></div>
          <div><span>⌁</span><strong>Observabilidad</strong><small>Visibilidad operativa del flujo.</small></div>
        </div>
      )}

      <div className="auth-security-note">
        <span>✓</span>
        <p><strong>Diseñado para operar como Tech Provider</strong><small>Permisos, tokens y conexiones permanecen en el backend.</small></p>
      </div>
    </section>
  );
}
