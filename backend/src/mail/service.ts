import { randomUUID } from "node:crypto";

import nodemailer, { type Transporter, type TransportOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import { AppError } from "../lib/errors.js";
import { getSmtpSettings, type SmtpSettings } from "../settings/service.js";

export interface AppEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SmtpQueueReport {
  status: "queued";
  messageId: string;
  deliveryId: string;
  response: string;
  accepted: string[];
  rejected: string[];
  pending: string[];
  envelope: { from: string; to: string[] };
  transport: "implicit-tls" | "starttls";
  port: number;
  warnings: string[];
}

interface RawSmtpResult {
  messageId?: unknown;
  response?: unknown;
  accepted?: unknown;
  rejected?: unknown;
  pending?: unknown;
  envelope?: { from?: unknown; to?: unknown };
}

interface SmtpErrorLike {
  code?: unknown;
  responseCode?: unknown;
  command?: unknown;
  response?: unknown;
  message?: unknown;
}

export function resolveSmtpTransportSecurity(port: number, configuredSecure: boolean) {
  if (port === 465) return { secure: true, requireTLS: false, transport: "implicit-tls" as const };
  if (port === 587) return { secure: false, requireTLS: true, transport: "starttls" as const };
  return configuredSecure
    ? { secure: true, requireTLS: false, transport: "implicit-tls" as const }
    : { secure: false, requireTLS: true, transport: "starttls" as const };
}

function mailbox(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "address" in value && typeof value.address === "string") {
    return value.address;
  }
  return undefined;
}

function mailboxList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(mailbox).filter((address): address is string => Boolean(address)) : [];
}

function recipientDomain(recipient: string): string {
  return recipient.split("@").at(-1)?.toLowerCase() ?? "unknown";
}

function redactMailboxes(value: string): string {
  return value.replace(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi, "***@$1");
}

function smtpConfigurationWarnings(config: SmtpSettings): string[] {
  const username = config.username.trim().toLowerCase();
  const fromEmail = config.fromEmail.trim().toLowerCase();
  if (!username.includes("@") || username === fromEmail) return [];

  const usernameDomain = recipientDomain(username);
  const fromDomain = recipientDomain(fromEmail);
  return usernameDomain === fromDomain
    ? ["El usuario SMTP y el remitente son buzones distintos. Confirma que el proveedor permita enviar con ese From."]
    : ["El dominio del remitente no coincide con el usuario SMTP. Esto puede romper la alineación SPF/DMARC."];
}

export function smtpErrorDetails(error: unknown) {
  const smtpError = (error && typeof error === "object" ? error : {}) as SmtpErrorLike;
  const text = (value: unknown) => typeof value === "string"
    ? redactMailboxes(value.slice(0, 1_000))
    : undefined;
  const responseCode = typeof smtpError.responseCode === "number" ? smtpError.responseCode : undefined;
  return {
    code: text(smtpError.code),
    responseCode,
    command: text(smtpError.command),
    response: text(smtpError.response),
    message: text(smtpError.message) ?? (error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000)),
  };
}

export function createSmtpTransport(
  config: SmtpSettings,
): Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options> {
  const security = resolveSmtpTransportSecurity(config.port, config.secure);
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: security.secure,
    requireTLS: security.requireTLS,
    ...(config.username
      ? { auth: { user: config.username, pass: config.password } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
}

export async function sendUsingTransport<T, D extends TransportOptions>(
  transporter: Transporter<T, D>,
  config: Pick<SmtpSettings, "fromName" | "fromEmail" | "replyTo">,
  email: AppEmail,
): Promise<T> {
  const deliveryId = randomUUID();
  const messageDomain = recipientDomain(config.fromEmail);
  const message: SMTPTransport.MailOptions = {
    from: { name: config.fromName, address: config.fromEmail },
    replyTo: config.replyTo || undefined,
    to: email.to,
    envelope: { from: config.fromEmail, to: [email.to] },
    messageId: `<${deliveryId}@${messageDomain}>`,
    dsn: {
      envid: deliveryId,
      ret: "HDRS",
      notify: ["FAILURE", "DELAY"],
      orcpt: email.to,
    },
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      "X-THagencia-Delivery-ID": deliveryId,
    },
    subject: email.subject,
    text: email.text,
    html: email.html,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
  return transporter.sendMail(message);
}

function confirmSmtpQueue(
  rawResult: unknown,
  config: SmtpSettings,
  recipient: string,
): SmtpQueueReport {
  const result = (rawResult && typeof rawResult === "object" ? rawResult : {}) as RawSmtpResult;
  const accepted = mailboxList(result.accepted);
  const rejected = mailboxList(result.rejected);
  const pending = mailboxList(result.pending);
  const envelopeFrom = mailbox(result.envelope?.from) ?? config.fromEmail;
  const envelopeTo = mailboxList(result.envelope?.to);
  const response = typeof result.response === "string" ? result.response.slice(0, 1_000) : "";
  const messageId = typeof result.messageId === "string" ? result.messageId : "";

  if (accepted.length === 0 || rejected.length > 0) {
    const queueError = Object.assign(
      new Error("El servidor SMTP no aceptó al destinatario para poner el mensaje en cola."),
      {
        code: "ESMTPRECIPIENT",
        response,
        accepted,
        rejected,
        pending,
      },
    );
    throw queueError;
  }

  const security = resolveSmtpTransportSecurity(config.port, config.secure);
  const deliveryId = messageId.match(/^<([^@>]+)@/)?.[1] ?? "unknown";
  return {
    status: "queued",
    messageId,
    deliveryId,
    response,
    accepted,
    rejected,
    pending,
    envelope: { from: envelopeFrom, to: envelopeTo.length > 0 ? envelopeTo : [recipient] },
    transport: security.transport,
    port: config.port,
    warnings: smtpConfigurationWarnings(config),
  };
}

async function queueMessage(
  transporter: Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options>,
  config: SmtpSettings,
  email: AppEmail,
): Promise<SmtpQueueReport> {
  try {
    const rawResult = await sendUsingTransport(transporter, config, email);
    const report = confirmSmtpQueue(rawResult, config, email.to);
    console.info("[mail] SMTP queued message", {
      messageId: report.messageId,
      recipientDomain: recipientDomain(email.to),
      response: redactMailboxes(report.response),
      transport: report.transport,
      port: report.port,
      warnings: report.warnings,
    });
    return report;
  } catch (error) {
    console.error("[mail] SMTP queue failed", {
      recipientDomain: recipientDomain(email.to),
      ...smtpErrorDetails(error),
    });
    throw error;
  }
}

export async function sendAppEmail(email: AppEmail) {
  const setting = await getSmtpSettings(true);
  if (!setting) {
    throw new AppError(503, "smtp_not_configured", "SMTP no está configurado o se encuentra desactivado.");
  }

  const transporter = createSmtpTransport(setting.config);
  try {
    return await queueMessage(transporter, setting.config, email);
  } finally {
    transporter.close();
  }
}

export async function sendSmtpTest(config: SmtpSettings, recipient: string) {
  const transporter = createSmtpTransport(config);
  try {
    await transporter.verify();
    return await queueMessage(transporter, config, {
      to: recipient,
      subject: "Prueba SMTP · THagencia Tech Provider",
      text: "La configuración SMTP funciona correctamente.",
      html: "<div style=\"font-family:Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px\"><h1 style=\"color:#ff6b35\">SMTP configurado</h1><p>THagencia Tech Provider pudo conectarse y enviar este mensaje correctamente.</p></div>",
    });
  } catch (error) {
    throw new AppError(502, "smtp_test_failed", "No fue posible enviar el correo de prueba.", {
      ...smtpErrorDetails(error),
    });
  } finally {
    transporter.close();
  }
}
