import type { Metadata } from "next";
import { Brand } from "@/components/Brand";
import { DataDeletionStatus } from "@/components/DataDeletionStatus";

export const metadata: Metadata = {
  title: "Eliminación de datos · THagencia Tech Provider",
  description: "Consulta el estado de una solicitud de eliminación de datos de Meta.",
  referrer: "no-referrer",
};

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : undefined;
  return <main className="auth-shell">
    <div className="auth-side">
      <Brand />
      <section className="auth-context">
        <p className="eyebrow">Privacidad y control</p>
        <h2>Tus datos y credenciales permanecen bajo tu control.</h2>
        <p>Procesamos las solicitudes firmadas por Meta y eliminamos tokens, identificadores de WhatsApp, configuración de entrega y registros relacionados.</p>
        <div className="auth-security-note"><span>✓</span><p><strong>Solicitud verificada criptográficamente</strong><small>Solo aceptamos callbacks firmados con el App Secret de Meta.</small></p></div>
      </section>
      <p className="auth-side-footer">THagencia Tech Provider · Privacidad</p>
    </div>
    <section className="auth-card"><DataDeletionStatus confirmationCode={code} /></section>
  </main>;
}
