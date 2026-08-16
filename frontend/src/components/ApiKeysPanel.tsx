"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

interface ApiKeyItem {
  id: string;
  name: string;
  maskedKey: string;
  scopes: string[];
  status: "ACTIVE" | "REVOKED";
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface ApiKeysPanelProps {
  userRole: string;
  exampleConnectionId?: string;
}

export function ApiKeysPanel({ userRole, exampleConnectionId }: ApiKeysPanelProps) {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState("Integración principal");
  const [expiresAt, setExpiresAt] = useState("");
  const [revealedToken, setRevealedToken] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const canManage = userRole === "OWNER" || userRole === "ADMIN";

  const loadApiKeys = useCallback(async () => {
    try {
      const payload = await apiFetch<{ apiKeys: ApiKeyItem[] }>("/api/api-keys");
      setApiKeys(payload.apiKeys);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible cargar las API Keys.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadApiKeys(), 0);
    return () => window.clearTimeout(timer);
  }, [loadApiKeys]);

  async function createApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    setRevealedToken(undefined);
    try {
      const payload = await apiFetch<{ apiKey: ApiKeyItem; token: string }>("/api/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      setApiKeys((current) => [payload.apiKey, ...current]);
      setRevealedToken(payload.token);
      setMessage("API Key creada. Copia el token antes de cerrar esta página.");
      setName("Integración principal");
      setExpiresAt("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible crear la API Key.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeApiKey(apiKey: ApiKeyItem) {
    if (!window.confirm(`¿Revocar “${apiKey.name}”? Las integraciones que la usen dejarán de funcionar.`)) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await apiFetch<void>(`/api/api-keys/${apiKey.id}`, { method: "DELETE" });
      setApiKeys((current) => current.map((item) => item.id === apiKey.id
        ? { ...item, status: "REVOKED" }
        : item));
      setMessage("API Key revocada.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible revocar la API Key.");
    } finally {
      setBusy(false);
    }
  }

  const example = `curl -X POST https://TU_DOMINIO/api/v1/messages/send \\
  -H "Authorization: Bearer TU_API_KEY" \\
  -H "Idempotency-Key: pedido-10001" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    ...(exampleConnectionId ? { connection_id: exampleConnectionId } : {}),
    to: "5215512345678",
    type: "text",
    text: { body: "Hola desde THagencia" },
  })}'`;

  return (
    <section className="webhook-module" id="api-keys">
      <div className="section-heading webhook-heading">
        <div><p className="eyebrow">Parte 4 · API Gateway outbound</p><h2>API Keys</h2><p>Autoriza a n8n o tu CRM para enviar mensajes sin exponer el token de Meta.</p></div>
        <span className="tenant-chip">Scope · messages:send</span>
      </div>

      <div className="webhook-grid api-key-grid">
        <article className="panel">
          <form className="webhook-form" onSubmit={createApiKey}>
            <label>Nombre de la integración
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={!canManage} required />
              <small>Ejemplo: n8n producción, Novemp o CRM comercial.</small>
            </label>
            <label>Expiración opcional
              <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={!canManage} />
              <small>Sin fecha permanecerá activa hasta que la revoques.</small>
            </label>
            {revealedToken && <div className="secret-reveal"><strong>Token visible por única vez</strong><code>{revealedToken}</code><button className="button button-ghost button-small" type="button" onClick={() => void navigator.clipboard.writeText(revealedToken)}>Copiar token</button></div>}
            {message && <p className="alert alert-success" role="status">{message}</p>}
            {error && <p className="alert alert-error" role="alert">{error}</p>}
            {!canManage && <p className="alert">Solo owners y admins pueden crear o revocar API Keys.</p>}
            <button className="button button-primary" type="submit" disabled={busy || !canManage}>{busy ? "Procesando…" : "Crear API Key"}</button>
          </form>
        </article>

        <article className="panel api-key-list-panel">
          <div className="panel-title-row"><div><h2>Credenciales</h2><p>{apiKeys.length} credencial{apiKeys.length === 1 ? "" : "es"}</p></div><span className="count-badge">{apiKeys.filter((item) => item.status === "ACTIVE").length}</span></div>
          {apiKeys.length === 0 ? <div className="empty-state"><span>⌁</span><strong>Sin API Keys</strong><p>Crea la primera para conectar n8n o tu CRM.</p></div> : (
            <div className="api-key-list">
              {apiKeys.map((apiKey) => <div className="api-key-item" key={apiKey.id}>
                <div><strong>{apiKey.name}</strong><code>{apiKey.maskedKey}</code><small>Creada {new Date(apiKey.createdAt).toLocaleDateString("es-MX")} · {apiKey.lastUsedAt ? `Último uso ${new Date(apiKey.lastUsedAt).toLocaleString("es-MX")}` : "Sin uso"}</small></div>
                <span className={`status-badge ${apiKey.status === "REVOKED" ? "status-revoked" : ""}`}><i />{apiKey.status}</span>
                {apiKey.status === "ACTIVE" && canManage && <button className="button button-ghost button-small" type="button" disabled={busy} onClick={() => void revokeApiKey(apiKey)}>Revocar</button>}
              </div>)}
            </div>
          )}
        </article>
      </div>

      <article className="panel gateway-example">
        <div><p className="eyebrow">Ejemplo rápido</p><h3>Enviar un mensaje de texto</h3><p><code>Idempotency-Key</code> evita duplicados si tu CRM reintenta la misma operación.</p></div>
        <pre><code>{example}</code></pre>
      </article>
    </section>
  );
}
