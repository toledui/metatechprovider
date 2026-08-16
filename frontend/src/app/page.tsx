import Link from "next/link";

import { Brand } from "@/components/Brand";

export default function Home() {
  return (
    <main className="landing-shell">
      <nav className="topbar">
        <Brand />
        <div className="marketing-nav">
          <a href="#plataforma">Plataforma</a>
          <a href="#flujo">Cómo funciona</a>
          <a href="#seguridad">Seguridad</a>
        </div>
        <div className="nav-actions">
          <Link className="button button-ghost" href="/login">Iniciar sesión</Link>
          <Link className="button button-primary button-small" href="/register">Crear cuenta</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">WhatsApp Business Platform</p>
          <h1>Infraestructura Meta para empresas que crecen.</h1>
          <p className="hero-text">La capa central para vincular empresas con WhatsApp Business, proteger sus credenciales y enrutar conversaciones hacia n8n, CRMs y servicios externos.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/register">Comenzar onboarding</Link>
            <Link className="text-link" href="/login">Ya tengo una cuenta →</Link>
          </div>
          <div className="hero-proof">
            <span><i /> Multitenant B2B</span>
            <span><i /> Embedded Signup</span>
            <span><i /> API Gateway</span>
          </div>
        </div>
        <div className="architecture-card">
          <div className="status-line"><span className="status-dot" /> Gateway disponible</div>
          <div className="flow-step"><span>01</span><div><strong>Embedded Signup</strong><small>Vinculación segura con Meta</small></div></div>
          <div className="flow-connector" />
          <div className="flow-step"><span>02</span><div><strong>Tenant aislado</strong><small>Credenciales cifradas por empresa</small></div></div>
          <div className="flow-connector" />
          <div className="flow-step muted"><span>03</span><div><strong>n8n / CRM</strong><small>Enrutamiento bidireccional · próxima fase</small></div></div>
        </div>
      </section>

      <section className="capability-strip" aria-label="Capacidades de la plataforma">
        <p>Construido para</p>
        <div><span>Meta Cloud API</span><span>WhatsApp Business</span><span>n8n</span><span>CRMs externos</span><span>Coexistence</span></div>
      </section>

      <section className="marketing-section platform-section" id="plataforma">
        <div className="section-intro">
          <p className="eyebrow">Una capa central, múltiples negocios</p>
          <h2>La infraestructura entre Meta y la operación de tus clientes.</h2>
          <p>THagencia Tech Provider no reemplaza tus automatizaciones. Les entrega identidad, seguridad, conexión y una ruta uniforme para comunicarse con WhatsApp.</p>
        </div>
        <div className="product-grid">
          <article className="product-card featured">
            <span className="product-index">01</span>
            <div className="product-icon">◎</div>
            <h3>Onboarding administrado</h3>
            <p>Cada empresa vincula su WABA y número mediante Embedded Signup, incluyendo líneas con Coexistence.</p>
            <ul><li>WABA y Phone Number ID</li><li>Suscripción automática de la app</li><li>Credenciales cifradas por tenant</li></ul>
          </article>
          <article className="product-card">
            <span className="product-index">02</span><div className="product-icon">↔</div>
            <h3>Gateway bidireccional</h3>
            <p>Un punto de entrada para recibir eventos de Meta y despachar mensajes desde cualquier integración autorizada.</p>
          </article>
          <article className="product-card">
            <span className="product-index">03</span><div className="product-icon">◇</div>
            <h3>Control multitenant</h3>
            <p>Organizaciones, usuarios, conexiones, API Keys y registros operativos separados desde la base de datos.</p>
          </article>
          <article className="product-card">
            <span className="product-index">04</span><div className="product-icon">⌁</div>
            <h3>Configuración global</h3>
            <p>SMTP, credenciales Meta y futuros proveedores administrados por THagencia desde un Superadmin seguro.</p>
          </article>
        </div>
      </section>

      <section className="marketing-section flow-section" id="flujo">
        <div className="section-intro compact">
          <p className="eyebrow">Cómo circula una conversación</p>
          <h2>Tu lógica sigue en n8n. La plataforma se encarga del camino.</h2>
        </div>
        <div className="gateway-flow">
          <div className="gateway-node"><span>01</span><strong>Meta</strong><small>Webhook global</small></div>
          <div className="gateway-arrow"><i /> Evento entrante</div>
          <div className="gateway-node core"><span>02</span><strong>THagencia Gateway</strong><small>Identidad · Seguridad · Routing</small></div>
          <div className="gateway-arrow"><i /> HMAC seguro</div>
          <div className="gateway-node"><span>03</span><strong>n8n / CRM</strong><small>Automatización y negocio</small></div>
        </div>
        <div className="flow-return">Respuesta normalizada → API Key → Token del tenant → Meta Graph API</div>
      </section>

      <section className="marketing-section security-section" id="seguridad">
        <div className="security-copy">
          <p className="eyebrow">Seguridad desde la arquitectura</p>
          <h2>Los secretos viven donde deben: fuera del navegador.</h2>
          <p>La plataforma está diseñada para operar múltiples empresas sin mezclar identidades, tokens ni permisos.</p>
          <Link className="text-link" href="/register">Crear un espacio seguro →</Link>
        </div>
        <div className="security-list">
          <div><span>01</span><p><strong>AES-256-GCM</strong><small>Tokens y configuraciones cifrados antes de llegar a MySQL.</small></p></div>
          <div><span>02</span><p><strong>Autorización en backend</strong><small>Roles del tenant separados del rol global Superadmin.</small></p></div>
          <div><span>03</span><p><strong>Credenciales aisladas</strong><small>Cada conexión resuelve únicamente los activos de su empresa.</small></p></div>
          <div><span>04</span><p><strong>Auditoría preparada</strong><small>Logs, deduplicación y observabilidad para cada entrega.</small></p></div>
        </div>
      </section>

      <section className="roadmap-section">
        <div><p className="eyebrow">Evolución de la plataforma</p><h2>Una base diseñada para crecer por módulos.</h2></div>
        <div className="roadmap-grid">
          <span className="done"><i>✓</i><strong>Persistencia</strong><small>Multitenant + Prisma</small></span>
          <span className="done"><i>✓</i><strong>Onboarding</strong><small>Embedded Signup</small></span>
          <span className="active"><i>03</i><strong>Webhooks</strong><small>Routing + reintentos</small></span>
          <span className="done"><i>04</i><strong>API Gateway</strong><small>Mensajes + API Keys</small></span>
          <span><i>05</i><strong>Billing</strong><small>Stripe + planes SaaS</small></span>
        </div>
      </section>

      <section className="final-cta">
        <div><p className="eyebrow">Empieza con una organización</p><h2>Conecta tu primer negocio a la infraestructura de THagencia.</h2></div>
        <div><Link className="button button-primary" href="/register">Crear cuenta</Link><Link className="button button-ghost" href="/login">Entrar al panel</Link></div>
      </section>

      <footer className="marketing-footer">
        <Brand />
        <p>Gateway multitenant para WhatsApp Business Platform.</p>
        <span>© {new Date().getFullYear()} THagencia</span>
      </footer>
    </main>
  );
}
