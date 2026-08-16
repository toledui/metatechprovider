"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

interface PublicConfig {
  meta: {
    appId: string | null;
    configId: string | null;
    graphApiVersion: string;
    configured: boolean;
  };
}

interface SessionInfo {
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
}

interface Connection {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string;
  coexistenceEnabled: boolean;
  webhookUrl: string | null;
  webhookSecretConfigured: boolean;
}

interface EmbeddedSignupButtonProps {
  onConnected(connection: Connection): void;
}

const META_MESSAGE_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
  "https://business.facebook.com",
]);

function readSessionMessage(raw: unknown): { event?: string; info?: SessionInfo } | null {
  let message = raw;
  if (typeof raw === "string") {
    try {
      message = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!message || typeof message !== "object") return null;

  const candidate = message as {
    type?: string;
    event?: string;
    data?: { waba_id?: string; phone_number_id?: string; business_id?: string };
  };
  if (candidate.type !== "WA_EMBEDDED_SIGNUP") return null;

  return {
    event: candidate.event,
    info: {
      wabaId: candidate.data?.waba_id,
      phoneNumberId: candidate.data?.phone_number_id,
      businessId: candidate.data?.business_id,
    },
  };
}

export function EmbeddedSignupButton({ onConnected }: EmbeddedSignupButtonProps) {
  const [config, setConfig] = useState<PublicConfig["meta"]>();
  const [sdkReady, setSdkReady] = useState(false);
  const [coexistence, setCoexistence] = useState(true);
  const [status, setStatus] = useState<"idle" | "waiting" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>();
  const sessionRef = useRef<SessionInfo>({});
  const codeRef = useRef<string | undefined>(undefined);
  const submittingRef = useRef(false);

  useEffect(() => {
    apiFetch<PublicConfig>("/api/config/public")
      .then((payload) => setConfig(payload.meta))
      .catch(() => setMessage("No fue posible cargar la configuración pública de Meta."));
  }, []);

  const initializeSdk = useCallback(() => {
    if (!config?.appId || !window.FB) return;
    window.FB.init({
      appId: config.appId,
      cookie: true,
      xfbml: false,
      version: config.graphApiVersion,
    });
    setSdkReady(true);
  }, [config]);

  const persistConnection = useCallback(async () => {
    if (!codeRef.current || submittingRef.current) return;
    submittingRef.current = true;
    setStatus("saving");
    setMessage("Validando activos y suscribiendo el WABA…");

    try {
      const payload = await apiFetch<{ connection: Connection }>("/api/auth/facebook/callback", {
        method: "POST",
        body: JSON.stringify({
          code: codeRef.current,
          ...sessionRef.current,
          coexistence,
        }),
      });
      codeRef.current = undefined;
      setStatus("success");
      setMessage("Línea conectada y suscrita correctamente.");
      onConnected(payload.connection);
    } catch (caught) {
      submittingRef.current = false;
      setStatus("error");
      setMessage(caught instanceof ApiError ? caught.message : "No fue posible completar el onboarding.");
    }
  }, [coexistence, onConnected]);

  useEffect(() => {
    function sessionInfoListener(event: MessageEvent) {
      if (!META_MESSAGE_ORIGINS.has(event.origin)) return;
      const session = readSessionMessage(event.data);
      if (!session) return;

      if (session.event === "CANCEL") {
        setStatus("idle");
        setMessage("El onboarding fue cancelado.");
        return;
      }
      if (session.event === "ERROR") {
        setStatus("error");
        setMessage("Meta informó un error durante el onboarding.");
        return;
      }
      if (
        session.event === "FINISH" ||
        session.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
      ) {
        sessionRef.current = session.info ?? {};
        void persistConnection();
      }
    }

    window.addEventListener("message", sessionInfoListener);
    return () => window.removeEventListener("message", sessionInfoListener);
  }, [persistConnection]);

  useEffect(() => {
    const timer = window.setTimeout(initializeSdk, 0);
    return () => window.clearTimeout(timer);
  }, [initializeSdk]);

  function launchSignup() {
    if (!window.FB || !config?.configId) return;
    if (window.location.protocol !== "https:") {
      setStatus("error");
      setMessage("Meta exige HTTPS para abrir Facebook Login. Reinicia npm run dev y entra por https://localhost:3000.");
      return;
    }
    sessionRef.current = {};
    codeRef.current = undefined;
    submittingRef.current = false;
    setStatus("waiting");
    setMessage("Completa el proceso en la ventana de Meta.");

    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setStatus("idle");
          setMessage("Meta no devolvió un código. El proceso pudo haberse cancelado.");
          return;
        }
        codeRef.current = code;
        window.setTimeout(() => void persistConnection(), 600);
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          sessionInfoVersion: "3",
          ...(coexistence ? { featureType: "whatsapp_business_app_onboarding" as const } : {}),
        },
      },
    );
  }

  const configured = config?.configured ?? false;
  const busy = status === "waiting" || status === "saving";

  return (
    <div className="signup-module">
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        onReady={initializeSdk}
        onError={() => {
          setSdkReady(false);
          setStatus("error");
          setMessage("No fue posible cargar el SDK de Facebook.");
        }}
      />

      <label className="switch-row">
        <input
          type="checkbox"
          checked={coexistence}
          onChange={(event) => setCoexistence(event.target.checked)}
          disabled={busy}
        />
        <span>
          <strong>Usar Coexistence</strong>
          <small>Conserva la app WhatsApp Business vinculada al mismo número.</small>
        </span>
      </label>

      {!configured && config && (
        <p className="alert alert-warning">
          Configuración pendiente: agrega las variables META_* y CREDENTIALS_ENCRYPTION_KEY en backend/.env.
        </p>
      )}
      {message && (
        <p className={`alert ${status === "error" ? "alert-error" : status === "success" ? "alert-success" : ""}`} role="status">
          {message}
        </p>
      )}
      <button
        className="button button-meta"
        type="button"
        onClick={launchSignup}
        disabled={!configured || !sdkReady || busy}
      >
        <span className="meta-icon">f</span>
        {status === "saving" ? "Guardando conexión…" : status === "waiting" ? "Esperando a Meta…" : "Conectar con Facebook"}
      </button>
      <p className="privacy-note">El access token se intercambia y cifra exclusivamente en el backend.</p>
    </div>
  );
}
