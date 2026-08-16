import { env } from "../config/env.js";
import type { AppEmail } from "./service.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}

function emailLayout(title: string, intro: string, action: string, url: string, note: string): string {
  return `<div style="margin:0;padding:32px;background:#0a0a0a;color:#a3a3a3;font-family:Arial,sans-serif;line-height:1.6">
    <div style="max-width:600px;margin:0 auto;padding:32px;border:1px solid #2a2a2a;border-radius:16px;background:#1a1a1a">
      <p style="margin:0 0 24px;color:#ff6b35;font-weight:700">THagencia Tech Provider</p>
      <h1 style="margin:0 0 16px;color:#ffffff;font-size:28px">${escapeHtml(title)}</h1>
      <p style="margin:0 0 24px">${escapeHtml(intro)}</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 20px;border-radius:9px;background:#ff6b35;color:#ffffff;font-weight:700;text-decoration:none">${escapeHtml(action)}</a>
      <p style="margin:24px 0 0;color:#7a7a7a;font-size:13px">${escapeHtml(note)}</p>
    </div>
  </div>`;
}

export function verificationEmail(to: string, name: string, token: string): AppEmail {
  const url = `${env.appOrigin}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Confirma tu cuenta · THagencia Tech Provider",
    text: `Hola ${name}. Confirma tu correo para activar tu cuenta: ${url}\n\nEl enlace vence en 24 horas y solo puede utilizarse una vez.`,
    html: emailLayout(
      "Confirma tu cuenta",
      `Hola ${name}. Verifica que este correo te pertenece para activar tu espacio de trabajo.`,
      "Confirmar mi correo",
      url,
      "Este enlace vence en 24 horas y solo puede utilizarse una vez. Si no creaste la cuenta, ignora este mensaje.",
    ),
  };
}

export function passwordResetEmail(to: string, name: string, token: string): AppEmail {
  const url = `${env.appOrigin}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Restablece tu contraseña · THagencia Tech Provider",
    text: `Hola ${name}. Restablece tu contraseña: ${url}\n\nEl enlace vence en 1 hora y solo puede utilizarse una vez.`,
    html: emailLayout(
      "Restablece tu contraseña",
      `Hola ${name}. Recibimos una solicitud para cambiar la contraseña de tu cuenta.`,
      "Crear nueva contraseña",
      url,
      "Este enlace vence en 1 hora y solo puede utilizarse una vez. Si no hiciste la solicitud, ignora este mensaje.",
    ),
  };
}

export function passwordChangedEmail(to: string, name: string): AppEmail {
  return {
    to,
    subject: "Tu contraseña fue actualizada · THagencia Tech Provider",
    text: `Hola ${name}. La contraseña de tu cuenta fue actualizada y todas las sesiones anteriores se cerraron. Si no fuiste tú, contacta al administrador de la plataforma de inmediato.`,
    html: `<div style="margin:0;padding:32px;background:#0a0a0a;color:#a3a3a3;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px;border:1px solid #2a2a2a;border-radius:16px;background:#1a1a1a"><p style="color:#ff6b35;font-weight:700">THagencia Tech Provider</p><h1 style="color:#fff">Contraseña actualizada</h1><p>Hola ${escapeHtml(name)}. Tu contraseña fue actualizada y todas las sesiones anteriores se cerraron.</p><p style="color:#ffaaaa">Si no fuiste tú, contacta al administrador de la plataforma de inmediato.</p></div></div>`,
  };
}

export function tenantInvitationEmail(
  to: string,
  tenantName: string,
  inviterName: string,
  role: "ADMIN" | "MEMBER",
  token: string,
): AppEmail {
  const url = `${env.appOrigin}/invite?token=${encodeURIComponent(token)}`;
  const roleLabel = role === "ADMIN" ? "administrador" : "miembro";
  return {
    to,
    subject: `Invitación a ${tenantName} · THagencia Tech Provider`,
    text: `${inviterName} te invitó a ${tenantName} como ${roleLabel}. Acepta la invitación y crea tu acceso: ${url}\n\nEl enlace vence en 72 horas y solo puede utilizarse una vez.`,
    html: emailLayout(
      `Únete a ${tenantName}`,
      `${inviterName} te invitó a colaborar como ${roleLabel} en THagencia Tech Provider.`,
      "Aceptar invitación",
      url,
      "Este enlace vence en 72 horas y solo puede utilizarse una vez. Si no esperabas esta invitación, ignora el mensaje.",
    ),
  };
}
