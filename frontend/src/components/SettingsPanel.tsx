"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

type ProviderId = "smtp" | "meta" | "stripe";

interface SettingsResponse {
  encryptionConfigured: boolean;
  providers: Array<{
    id: ProviderId;
    name: string;
    available: boolean;
    configured: boolean;
    enabled: boolean;
  }>;
  smtp: null | {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    passwordConfigured: boolean;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    updatedAt: string;
  };
  meta: null | {
    enabled: boolean;
    appId: string;
    appSecretConfigured: boolean;
    webhookVerifyTokenConfigured: boolean;
    configId: string;
    graphApiVersion: string;
    source: "environment" | "database";
    updatedAt: string | null;
  };
  stripe: { available: false; message: string };
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsResponse>();
  const [provider, setProvider] = useState<ProviderId>("smtp");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string }>();

  const load = useCallback(async () => {
    try {
      setSettings(await apiFetch<SettingsResponse>("/api/admin/settings"));
    } catch (caught) {
      setNotice({ type: "error", text: caught instanceof Error ? caught.message : "No fue posible cargar Settings." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveSmtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await save("smtp", {
      enabled: form.get("enabled") === "on",
      host: form.get("host"),
      port: Number(form.get("port")),
      secure: form.get("secure") === "on",
      username: form.get("username"),
      password: form.get("password"),
      fromName: form.get("fromName"),
      fromEmail: form.get("fromEmail"),
      replyTo: form.get("replyTo"),
    });
  }

  async function saveMeta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await save("meta", {
      enabled: form.get("enabled") === "on",
      appId: form.get("appId"),
      appSecret: form.get("appSecret"),
      configId: form.get("configId"),
      webhookVerifyToken: form.get("webhookVerifyToken"),
    });
  }

  async function save(target: "smtp" | "meta", payload: object) {
    setSaving(true);
    setNotice(undefined);
    try {
      await apiFetch(`/api/admin/settings/${target}`, { method: "PUT", body: JSON.stringify(payload) });
      setNotice({ type: "success", text: `${target === "smtp" ? "SMTP" : "Meta"} guardado correctamente.` });
      await load();
    } catch (caught) {
      setNotice({ type: "error", text: caught instanceof ApiError ? caught.message : "No fue posible guardar." });
    } finally {
      setSaving(false);
    }
  }

  async function testSmtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recipient = new FormData(event.currentTarget).get("recipient");
    setTesting(true);
    setNotice(undefined);
    try {
      const result = await apiFetch<{ messageId: string }>("/api/admin/settings/smtp/test", {
        method: "POST",
        body: JSON.stringify({ recipient }),
      });
      setNotice({ type: "success", text: `Correo aceptado por SMTP. Message ID: ${result.messageId}` });
    } catch (caught) {
      setNotice({ type: "error", text: caught instanceof ApiError ? caught.message : "El envío de prueba falló." });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <div className="settings-loading"><span className="spinner" />Cargando configuración…</div>;
  if (!settings) return <p className="alert alert-error">No fue posible cargar la configuración global.</p>;

  return (
    <div className="settings-layout">
      {!settings.encryptionConfigured && (
        <p className="alert alert-warning settings-warning">
          Configura CREDENTIALS_ENCRYPTION_KEY en backend/.env antes de guardar secretos.
        </p>
      )}
      {notice && <p className={`alert ${notice.type === "error" ? "alert-error" : "alert-success"}`}>{notice.text}</p>}

      <div className="provider-grid">
        {settings.providers.map((item) => (
          <button className={`provider-card ${provider === item.id ? "active" : ""}`} type="button" key={item.id} onClick={() => setProvider(item.id)}>
            <span className={`provider-icon provider-${item.id}`}>{item.id === "smtp" ? "@" : item.id === "meta" ? "f" : "S"}</span>
            <span><strong>{item.name}</strong><small>{!item.available ? "Próximamente" : item.configured ? item.enabled ? "Activo" : "Configurado · inactivo" : "Sin configurar"}</small></span>
            <i className={item.enabled ? "enabled" : ""} />
          </button>
        ))}
      </div>

      {provider === "smtp" && (
        <div className="settings-columns">
          <form className="settings-card settings-form" onSubmit={saveSmtp} key={settings.smtp?.updatedAt ?? "smtp-empty"}>
            <div className="settings-card-heading"><div><h2>Servidor SMTP</h2><p>Configuración global para correos transaccionales de toda la plataforma.</p></div><label className="mini-switch"><input name="enabled" type="checkbox" defaultChecked={settings.smtp?.enabled ?? false} /><span>Habilitado</span></label></div>
            <div className="form-grid">
              <label className="span-2">Servidor SMTP<input name="host" required defaultValue={settings.smtp?.host ?? ""} placeholder="smtp.ejemplo.com" /></label>
              <label>Puerto<input name="port" type="number" min={1} max={65535} required defaultValue={settings.smtp?.port ?? 587} /></label>
              <label className="checkbox-field"><input name="secure" type="checkbox" defaultChecked={settings.smtp?.secure ?? false} /><span><strong>TLS directo</strong><small>Normalmente para puerto 465</small></span></label>
              <label>Usuario<input name="username" defaultValue={settings.smtp?.username ?? ""} autoComplete="off" /></label>
              <label>Contraseña<input name="password" type="password" placeholder={settings.smtp?.passwordConfigured ? "Guardada · dejar vacío para conservar" : "Contraseña SMTP"} autoComplete="new-password" /></label>
              <label>Nombre del remitente<input name="fromName" required defaultValue={settings.smtp?.fromName ?? "THagencia"} /></label>
              <label>Correo del remitente<input name="fromEmail" type="email" required defaultValue={settings.smtp?.fromEmail ?? ""} /></label>
              <label className="span-2">Reply-To opcional<input name="replyTo" type="email" defaultValue={settings.smtp?.replyTo ?? ""} /></label>
            </div>
            <div className="settings-actions"><span>La contraseña se cifra antes de llegar a MySQL.</span><button className="button button-primary" disabled={saving || !settings.encryptionConfigured}>{saving ? "Guardando…" : "Guardar SMTP"}</button></div>
          </form>

          <form className="settings-card test-card" onSubmit={testSmtp}>
            <span className="test-icon">✉</span><h2>Probar envío</h2><p>Primero guarda la configuración. Se validará conexión, TLS, autenticación y entrega al servidor.</p>
            <label>Destinatario<input name="recipient" type="email" required placeholder="correo@ejemplo.com" /></label>
            <button className="button button-ghost" disabled={testing || !settings.smtp}>{testing ? "Enviando…" : "Enviar correo de prueba"}</button>
          </form>
        </div>
      )}

      {provider === "meta" && (
        <form className="settings-card settings-form" onSubmit={saveMeta} key={settings.meta?.updatedAt ?? settings.meta?.source ?? "meta-empty"}>
          <div className="settings-card-heading"><div><h2>Meta Business Platform</h2><p>Credenciales globales usadas por Embedded Signup y Graph API {settings.meta?.graphApiVersion ?? "v26.0"}.</p></div><label className="mini-switch"><input name="enabled" type="checkbox" defaultChecked={settings.meta?.enabled ?? false} /><span>Habilitado</span></label></div>
          {settings.meta?.source === "environment" && <p className="source-note">Actualmente se usa el fallback de backend/.env. Al guardar, la base cifrada será la nueva fuente.</p>}
          <div className="form-grid">
            <label>Meta App ID<input name="appId" required defaultValue={settings.meta?.appId ?? ""} /></label>
            <label>Configuration ID<input name="configId" required defaultValue={settings.meta?.configId ?? ""} /></label>
            <label className="span-2">Meta App Secret<input name="appSecret" type="password" autoComplete="new-password" placeholder={settings.meta?.appSecretConfigured ? "Guardado · dejar vacío para conservar" : "App Secret"} /></label>
            <label className="span-2">Webhook Verify Token<input name="webhookVerifyToken" type="password" autoComplete="new-password" placeholder={settings.meta?.webhookVerifyTokenConfigured ? "Guardado · dejar vacío para conservar" : "Necesario para verificar /api/webhooks/meta"} /></label>
          </div>
          <div className="settings-actions"><span>WABA, Phone Number ID y access tokens permanecen separados por tenant.</span><button className="button button-primary" disabled={saving || !settings.encryptionConfigured}>{saving ? "Guardando…" : "Guardar Meta"}</button></div>
        </form>
      )}

      {provider === "stripe" && (
        <div className="settings-card coming-soon-card"><span className="provider-icon provider-stripe">S</span><p className="eyebrow">Proveedor preparado</p><h2>Stripe</h2><p>Esta sección reservará Publishable Key, Secret Key y Webhook Signing Secret cuando se implemente facturación.</p><button className="button button-ghost" disabled>Próximamente</button></div>
      )}
    </div>
  );
}
