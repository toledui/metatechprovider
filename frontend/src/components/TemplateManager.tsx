"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: "AUTHENTICATION" | "MARKETING" | "UTILITY";
  status: string;
  qualityScore: string | null;
  rejectionReason: string | null;
  components: Array<Record<string, unknown>>;
  preview: string | null;
  variableCount: number;
  lastSyncedAt: string;
  connection: { id: string; name: string };
}

interface Connection { id: string; verifiedName: string | null; displayPhoneNumber: string | null; status: string }

interface TemplateManagerProps {
  open: boolean;
  canManage: boolean;
  onClose: () => void;
  onConversationCreated: (conversationId: string) => void;
  onTemplatesChanged?: (templates: WhatsAppTemplate[]) => void;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}

export function TemplateManager({ open, canManage, onClose, onConversationCreated, onTemplatesChanged }: TemplateManagerProps) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es_MX");
  const [category, setCategory] = useState<WhatsAppTemplate["category"]>("UTILITY");
  const [bodyText, setBodyText] = useState("");
  const [to, setTo] = useState("");
  const [variables, setVariables] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [templatePayload, connectionPayload] = await Promise.all([
        apiFetch<{ templates: WhatsAppTemplate[] }>("/api/whatsapp/templates"),
        apiFetch<{ connections: Connection[] }>("/api/whatsapp/connections"),
      ]);
      setTemplates(templatePayload.templates);
      onTemplatesChanged?.(templatePayload.templates);
      const active = connectionPayload.connections.filter((connection) => connection.status === "ACTIVE");
      setConnections(active);
      setConnectionId((current) => current || active[0]?.id || "");
      const first = templatePayload.templates[0];
      setSelectedId(first?.id ?? "");
      setVariables(Array.from({ length: first?.variableCount ?? 0 }, () => ""));
    } catch (caught) {
      setError(errorMessage(caught, "No fue posible cargar las plantillas."));
    }
  }, [onTemplatesChanged]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);

  const selected = useMemo(() => templates.find((template) => template.id === selectedId) ?? null, [selectedId, templates]);

  async function synchronize(id = connectionId) {
    if (!id) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const result = await apiFetch<{ synchronized: number }>("/api/whatsapp/templates/sync", { method: "POST", body: JSON.stringify({ connectionId: id }) });
      await load();
      setMessage(`${result.synchronized} plantilla(s) sincronizada(s) con Meta.`);
    } catch (caught) { setError(errorMessage(caught, "No fue posible sincronizar.")); }
    finally { setBusy(false); }
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      await apiFetch("/api/whatsapp/templates", { method: "POST", body: JSON.stringify({
        connectionId, name: name.trim(), language: language.trim(), category,
        components: [{ type: "BODY", text: bodyText.trim() }],
      }) });
      setName(""); setBodyText("");
      await load();
      setMessage("Plantilla enviada a revisión de Meta.");
    } catch (caught) { setError(errorMessage(caught, "No fue posible crear la plantilla.")); }
    finally { setBusy(false); }
  }

  async function editSelected() {
    if (!selected) return;
    const nextBody = window.prompt("Texto del cuerpo. Conserva variables como {{1}}, {{2}}.", selected.preview ?? "");
    if (nextBody === null || !nextBody.trim()) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      await apiFetch(`/api/whatsapp/templates/${selected.id}`, { method: "PATCH", body: JSON.stringify({
        category: selected.category, components: [{ type: "BODY", text: nextBody.trim() }],
      }) });
      await load();
      setMessage("Cambios enviados a Meta; la plantilla regresó a revisión cuando aplica.");
    } catch (caught) { setError(errorMessage(caught, "No fue posible editar la plantilla.")); }
    finally { setBusy(false); }
  }

  async function deleteSelected() {
    if (!selected || !window.confirm(`¿Eliminar ${selected.name} en Meta?`)) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      await apiFetch(`/api/whatsapp/templates/${selected.id}`, { method: "DELETE" });
      await load();
      setMessage("Plantilla eliminada en Meta.");
    } catch (caught) { setError(errorMessage(caught, "No fue posible eliminar la plantilla.")); }
    finally { setBusy(false); }
  }

  async function sendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const result = await apiFetch<{ conversationId: string }>(`/api/whatsapp/templates/${selected.id}/test`, {
        method: "POST", body: JSON.stringify({ to: to.trim(), variables }),
      });
      setMessage("Plantilla enviada y conversación creada correctamente.");
      onConversationCreated(result.conversationId);
    } catch (caught) { setError(errorMessage(caught, "No fue posible enviar la prueba.")); }
    finally { setBusy(false); }
  }

  if (!open) return null;
  return <div className="template-overlay" role="dialog" aria-modal="true" aria-label="Gestión de plantillas">
    <section className="template-manager">
      <header><div><p className="eyebrow">WhatsApp Business</p><h2>Plantillas</h2><span>Sincroniza, revisa estados y abre conversaciones.</span></div><button type="button" onClick={onClose} aria-label="Cerrar">×</button></header>
      {error && <p className="alert alert-error">{error}</p>}{message && <p className="alert alert-success">{message}</p>}
      <div className="template-manager-grid">
        <aside><label>Línea<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>{connections.map((connection) => <option value={connection.id} key={connection.id}>{connection.verifiedName ?? connection.displayPhoneNumber ?? connection.id}</option>)}</select></label><button className="button button-ghost button-small" type="button" disabled={!canManage || busy || !connectionId} onClick={() => void synchronize()}>Sincronizar con Meta</button><div className="template-list">{templates.map((template) => <button className={selectedId === template.id ? "active" : ""} type="button" key={template.id} onClick={() => { setSelectedId(template.id); setVariables(Array.from({ length: template.variableCount }, () => "")); }}><strong>{template.name}</strong><span>{template.language} · {template.category}</span><i className={`template-status status-${template.status.toLowerCase()}`}>{template.status}</i></button>)}{templates.length === 0 && <small>No hay plantillas sincronizadas.</small>}</div></aside>
        <main>
          {selected ? <article className="template-preview"><div><span className={`template-status status-${selected.status.toLowerCase()}`}>{selected.status}</span>{selected.qualityScore && <small>Calidad: {selected.qualityScore}</small>}</div><h3>{selected.name}</h3><p>{selected.preview ?? "Plantilla sin cuerpo de texto"}</p>{selected.rejectionReason && <small className="template-rejection">{selected.rejectionReason}</small>}<footer><button className="button button-ghost button-small" type="button" disabled={!canManage || busy} onClick={() => void editSelected()}>Editar</button><button className="button button-danger button-small" type="button" disabled={!canManage || busy} onClick={() => void deleteSelected()}>Eliminar</button></footer></article> : <div className="template-preview empty">Selecciona una plantilla.</div>}
          <form className="template-test-form" onSubmit={sendTest}><h3>Nueva conversación / envío de prueba</h3><label>Número con código de país<input value={to} onChange={(event) => setTo(event.target.value)} placeholder="5215512345678" required /></label>{variables.map((value, index) => <label key={index}>Variable {index + 1}<input value={value} onChange={(event) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} required /></label>)}<button className="button button-primary" type="submit" disabled={busy || selected?.status !== "APPROVED"}>{busy ? "Procesando…" : "Enviar plantilla"}</button></form>
          {canManage && <form className="template-create-form" onSubmit={createTemplate}><h3>Crear plantilla</h3><div><label>Nombre<input value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="seguimiento_cliente" required /></label><label>Idioma<input value={language} onChange={(event) => setLanguage(event.target.value)} required /></label><label>Categoría<select value={category} onChange={(event) => setCategory(event.target.value as WhatsAppTemplate["category"])}><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option><option value="AUTHENTICATION">Authentication</option></select></label></div><label>Cuerpo<textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} placeholder="Hola {{1}}, tenemos una actualización." rows={4} required /></label><small>Las variables deben ser consecutivas: {"{{1}}"}, {"{{2}}"}… Meta revisará el contenido.</small><button className="button button-secondary" type="submit" disabled={busy || !connectionId}>Enviar a revisión</button></form>}
        </main>
      </div>
    </section>
  </div>;
}
