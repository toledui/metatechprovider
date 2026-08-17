"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

export interface WebhookConnection {
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  webhookUrl: string | null;
  webhookSecretConfigured: boolean;
}

interface WebhookLog {
  id: string;
  connection: { id: string; phone: string } | null;
  eventType: string;
  status: string;
  attempts: number;
  httpStatus: number | null;
  error: string | null;
  receivedAt: string;
}

interface WebhookPanelProps {
  connections: WebhookConnection[];
  onConnectionUpdated(connection: WebhookConnection): void;
}

export function WebhookPanel({ connections, onConnectionUpdated }: WebhookPanelProps) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const connection = useMemo(
    () => connections.find((item) => item.id === connectionId) ?? connections[0],
    [connectionId, connections],
  );
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const webhookUrl = connection ? urlDrafts[connection.id] ?? connection.webhookUrl ?? "" : "";
  const [regenerateSecret, setRegenerateSecret] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string>();
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const loadLogs = useCallback(async () => {
    if (!connection) return;
    try {
      const payload = await apiFetch<{ logs: WebhookLog[] }>(
        `/api/whatsapp/webhooks/logs?connectionId=${encodeURIComponent(connection.id)}&take=20`,
      );
      setLogs(payload.logs);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible cargar los eventos.");
    }
  }, [connection]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLogs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLogs]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    setRevealedSecret(undefined);
    try {
      const payload = await apiFetch<{ connection: WebhookConnection; webhookSecret: string | null }>(
        `/api/whatsapp/connections/${connection.id}/webhook`,
        {
          method: "PUT",
          body: JSON.stringify({ webhookUrl: webhookUrl.trim() || null, regenerateSecret }),
        },
      );
      onConnectionUpdated(payload.connection);
      setUrlDrafts((current) => ({ ...current, [payload.connection.id]: payload.connection.webhookUrl ?? "" }));
      setRevealedSecret(payload.webhookSecret ?? undefined);
      setRegenerateSecret(false);
      setMessage(webhookUrl.trim() ? "Webhook guardado correctamente." : "Webhook desactivado.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible guardar el webhook.");
    } finally {
      setBusy(false);
    }
  }

  async function testWebhook() {
    if (!connection) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const payload = await apiFetch<{ eventId: string }>(
        `/api/whatsapp/connections/${connection.id}/webhook/test`,
        { method: "POST", body: "{}" },
      );
      setMessage(`Prueba encolada: ${payload.eventId}. Actualiza el historial en unos segundos.`);
      window.setTimeout(() => void loadLogs(), 1_200);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible probar el webhook.");
    } finally {
      setBusy(false);
    }
  }

  if (connections.length === 0) {
    return <article className="panel webhook-panel"><div className="empty-state"><span>↗</span><strong>Conecta una línea primero</strong><p>Después podrás configurar el destino de n8n o tu CRM.</p></div></article>;
  }

  return (
    <section className="dedicated-module">
      <div className="module-toolbar"><p>Los eventos se validan, persisten y entregan con firma HMAC.</p><button className="button button-ghost button-small" type="button" onClick={() => void loadLogs()}>Actualizar eventos</button></div>

      <div className="webhook-grid">
        <article className="panel">
          <form className="webhook-form" onSubmit={save}>
            <label>Línea de WhatsApp
              <select value={connection?.id ?? ""} onChange={(event) => {
                setConnectionId(event.target.value);
                setRegenerateSecret(false);
                setRevealedSecret(undefined);
              }}>
                {connections.map((item) => <option key={item.id} value={item.id}>{item.verifiedName ?? item.displayPhoneNumber ?? item.phoneNumberId}</option>)}
              </select>
            </label>
            <label>URL destino
              <input type="url" value={webhookUrl} onChange={(event) => connection && setUrlDrafts((current) => ({ ...current, [connection.id]: event.target.value }))} placeholder="https://n8n.ejemplo.com/webhook/whatsapp" />
              <small>HTTPS es obligatorio en producción. Déjalo vacío para desactivar la entrega.</small>
            </label>
            <label className="switch-row webhook-secret-switch">
              <input type="checkbox" checked={regenerateSecret} onChange={(event) => setRegenerateSecret(event.target.checked)} />
              <span><strong>Rotar secreto HMAC</strong><small>El secreto anterior dejará de validar nuevas entregas.</small></span>
            </label>
            {revealedSecret && <div className="secret-reveal"><strong>Guarda este secreto ahora</strong><code>{revealedSecret}</code><small>No volverá a mostrarse. Úsalo para validar `X-THagencia-Signature-256`.</small></div>}
            {message && <p className="alert alert-success" role="status">{message}</p>}
            {error && <p className="alert alert-error" role="alert">{error}</p>}
            <div className="webhook-actions">
              <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Procesando…" : "Guardar webhook"}</button>
              <button className="button button-ghost" type="button" disabled={busy || !connection?.webhookSecretConfigured} onClick={() => void testWebhook()}>Enviar prueba</button>
            </div>
          </form>
        </article>

        <article className="panel webhook-events">
          <div className="panel-title-row"><div><h2>Últimos eventos</h2><p>{logs.length} registros recientes</p></div><span className="count-badge">{logs.length}</span></div>
          {logs.length === 0 ? <div className="empty-state"><span>◎</span><strong>Sin eventos todavía</strong><p>Usa “Enviar prueba” o espera un webhook de Meta.</p></div> : (
            <div className="webhook-log-list">
              {logs.map((log) => <div className="webhook-log" key={log.id}>
                <span className={`webhook-state state-${log.status.toLowerCase()}`} />
                <div><strong>{log.eventType}</strong><small>{new Date(log.receivedAt).toLocaleString("es-MX")} · {log.attempts} intento{log.attempts === 1 ? "" : "s"}</small>{log.error && <em>{log.error}</em>}</div>
                <span>{log.httpStatus ?? log.status}</span>
              </div>)}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
