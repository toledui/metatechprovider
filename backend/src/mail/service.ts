import nodemailer, { type Transporter } from "nodemailer";

import { AppError } from "../lib/errors.js";
import { getSmtpSettings, type SmtpSettings } from "../settings/service.js";

export interface AppEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export function createSmtpTransport(config: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.username
      ? { auth: { user: config.username, pass: config.password } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { rejectUnauthorized: true },
  });
}

export async function sendUsingTransport(
  transporter: Transporter,
  config: Pick<SmtpSettings, "fromName" | "fromEmail" | "replyTo">,
  email: AppEmail,
) {
  return transporter.sendMail({
    from: { name: config.fromName, address: config.fromEmail },
    replyTo: config.replyTo || undefined,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

export async function sendAppEmail(email: AppEmail) {
  const setting = await getSmtpSettings(true);
  if (!setting) {
    throw new AppError(503, "smtp_not_configured", "SMTP no está configurado o se encuentra desactivado.");
  }

  const transporter = createSmtpTransport(setting.config);
  try {
    return await sendUsingTransport(transporter, setting.config, email);
  } finally {
    transporter.close();
  }
}

export async function sendSmtpTest(config: SmtpSettings, recipient: string) {
  const transporter = createSmtpTransport(config);
  try {
    await transporter.verify();
    return await sendUsingTransport(transporter, config, {
      to: recipient,
      subject: "Prueba SMTP · THagencia Tech Provider",
      text: "La configuración SMTP funciona correctamente.",
      html: "<div style=\"font-family:Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px\"><h1 style=\"color:#ff6b35\">SMTP configurado</h1><p>THagencia Tech Provider pudo conectarse y enviar este mensaje correctamente.</p></div>",
    });
  } catch (error) {
    const smtpError = error as { code?: string; message?: string };
    throw new AppError(502, "smtp_test_failed", "No fue posible enviar el correo de prueba.", {
      code: smtpError.code,
      message: smtpError.message,
    });
  } finally {
    transporter.close();
  }
}
