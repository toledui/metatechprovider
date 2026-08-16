"use client";

import { useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

interface DeletionStatus {
  status: "PENDING" | "COMPLETED" | "FAILED";
  affectedConnections: number;
  requestedAt: string;
  completedAt: string | null;
}

export function DataDeletionStatus({ confirmationCode }: { confirmationCode?: string }) {
  const [status, setStatus] = useState<DeletionStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!confirmationCode) return;
    apiFetch<DeletionStatus>(`/api/meta/data-deletion/status/${encodeURIComponent(confirmationCode)}`)
      .then(setStatus)
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "No fue posible consultar la solicitud."));
  }, [confirmationCode]);

  if (!confirmationCode) {
    return <div className="deletion-status"><span>i</span><h2>Eliminación de datos de Meta</h2><p>Cuando elimines THagencia Tech Provider desde tu cuenta de Meta, recibirás un código para consultar aquí el estado de la solicitud.</p><p>También puedes solicitar asistencia escribiendo a <a href="mailto:contacto@thagencia.com">contacto@thagencia.com</a>.</p></div>;
  }
  if (error) return <p className="alert alert-error" role="alert">{error}</p>;
  if (!status) return <div className="auth-result"><span className="spinner" /><h2>Consultando solicitud…</h2></div>;

  const completed = status.status === "COMPLETED";
  return <div className="deletion-status">
    <span>{completed ? "✓" : status.status === "FAILED" ? "!" : "…"}</span>
    <p className="eyebrow">Estado · {status.status}</p>
    <h2>{completed ? "Datos eliminados" : status.status === "FAILED" ? "La solicitud requiere atención" : "Solicitud en proceso"}</h2>
    <p>{completed
      ? `Eliminamos los datos y credenciales asociados a ${status.affectedConnections} conexión${status.affectedConnections === 1 ? "" : "es"} de WhatsApp.`
      : "Conserva esta URL para consultar nuevamente el estado."}</p>
    <dl><div><dt>Solicitada</dt><dd>{new Date(status.requestedAt).toLocaleString("es-MX")}</dd></div>{status.completedAt && <div><dt>Completada</dt><dd>{new Date(status.completedAt).toLocaleString("es-MX")}</dd></div>}</dl>
  </div>;
}
