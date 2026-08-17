"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { TemplateManager, type WhatsAppTemplate } from "@/components/TemplateManager";

type ConversationStatus = "OPEN" | "PENDING" | "RESOLVED";
type MessageStatus = "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
type ComposerType = "text" | "template" | "image" | "document" | "audio" | "video";

interface Tag { id: string; name: string; color: string }
interface Agent { id: string; name: string; role: string }
interface InboxTeam { id: string; name: string; color: string; memberIds?: string[] }
interface InboxPermissions { sendMessages: boolean; editContacts: boolean; assignConversations: boolean; changeStatus: boolean; manageTags: boolean; addNotes: boolean; manageTemplates: boolean }
interface Assignment { id: string; teamName: string | null; team: InboxTeam | null; createdAt: string; user: { id: string; name: string } | null }
interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  contact: { id: string; waId: string; name: string };
  connection: { id: string; name: string };
  tags: Tag[];
  assignment: Assignment | null;
  window: { open: boolean; expiresAt: string | null };
}
interface InboxMessage {
  id: string;
  externalId: string | null;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  status: MessageStatus;
  text: string | null;
  content: unknown;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  mediaUrl: string | null;
}
interface InternalNote { id: string; body: string; createdAt: string; author: { id: string; name: string } }
interface ConversationDetail extends Omit<ConversationSummary, "contact"> {
  contact: ConversationSummary["contact"] & {
    profileName: string | null;
    email: string | null;
    company: string | null;
    notes: string | null;
  };
  messages: InboxMessage[];
  nextBefore: string | null;
  notes: InternalNote[];
}
interface InboxPayload { conversations: ConversationSummary[]; nextCursor: string | null; agents: Agent[]; teams: InboxTeam[]; tags: Tag[]; permissions: InboxPermissions }

const defaultPermissions: InboxPermissions = { sendMessages: false, editContacts: false, assignConversations: false, changeStatus: false, manageTags: false, addNotes: false, manageTemplates: false };

const statusLabels: Record<ConversationStatus, string> = { OPEN: "Abierto", PENDING: "Pendiente", RESOLVED: "Resuelto" };
const messageTypeLabels: Record<string, string> = {
  IMAGE: "Imagen", DOCUMENT: "Documento", AUDIO: "Audio", VIDEO: "Video", STICKER: "Sticker",
  LOCATION: "Ubicación", CONTACTS: "Contacto", INTERACTIVE: "Respuesta interactiva", TEMPLATE: "Plantilla",
  REACTION: "Reacción", UNKNOWN: "Mensaje no compatible",
};

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function shortTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function exactTime(value: string): string {
  return new Date(value).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function statusIndicator(message: InboxMessage) {
  if (message.direction === "INBOUND") return null;
  const values: Record<MessageStatus, { symbol: string; label: string; className: string }> = {
    RECEIVED: { symbol: "✓", label: "Recibido", className: "" },
    SENT: { symbol: "✓", label: "Enviado", className: "" },
    DELIVERED: { symbol: "✓✓", label: "Entregado", className: "delivered" },
    READ: { symbol: "✓✓", label: "Leído", className: "read" },
    FAILED: { symbol: "!", label: "Fallido", className: "failed" },
  };
  const state = values[message.status];
  return <span className={`inbox-message-status ${state.className}`} title={message.error ?? state.label}>{state.symbol}</span>;
}

function messageBody(message: InboxMessage) {
  const isMedia = ["IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "STICKER"].includes(message.type);
  if (message.text && !isMedia) return <p>{message.text}</p>;
  const content = message.content && typeof message.content === "object" && !Array.isArray(message.content)
    ? message.content as Record<string, unknown> : {};
  const media = content[message.type.toLowerCase()];
  const mediaRecord = media && typeof media === "object" && !Array.isArray(media) ? media as Record<string, unknown> : {};
  const link = message.mediaUrl ?? (typeof mediaRecord.link === "string" ? mediaRecord.link : null);
  const label = messageTypeLabels[message.type] ?? message.type;
  return <div className="inbox-media-message"><span>{message.type === "AUDIO" ? "♫" : message.type === "DOCUMENT" ? "▤" : "◇"}</span><div><strong>{label}</strong>{message.text && <small>{message.text}</small>}{link ? <a href={link} target="_blank" rel="noreferrer">Abrir archivo</a> : <small>Contenido recibido por WhatsApp</small>}</div></div>;
}

export function InboxPanel() {
  const [payload, setPayload] = useState<InboxPayload>({ conversations: [], nextCursor: null, agents: [], teams: [], tags: [], permissions: defaultPermissions });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [realtime, setRealtime] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | ConversationStatus>("");
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [composerType, setComposerType] = useState<ComposerType>("text");
  const [text, setText] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateVariables, setTemplateVariables] = useState<string[]>([]);
  const [mediaLink, setMediaLink] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");
  const [mediaFilename, setMediaFilename] = useState("");
  const [note, setNote] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactCompany, setContactCompany] = useState("");
  const [contactNotes, setContactNotes] = useState("");
  const messagesEnd = useRef<HTMLDivElement>(null);
  const detailIdRef = useRef<string | null>(null);

  const loadList = useCallback(async (cursor?: string, append = false) => {
    const query = new URLSearchParams();
    if (search.trim()) query.set("search", search.trim());
    if (statusFilter) query.set("status", statusFilter);
    if (assignmentFilter) query.set("assignedTo", assignmentFilter);
    if (tagFilter) query.set("tag", tagFilter);
    if (unreadOnly) query.set("unread", "true");
    query.set("limit", "40");
    if (cursor) query.set("cursor", cursor);
    try {
      const next = await apiFetch<InboxPayload>(`/api/inbox${query.size ? `?${query}` : ""}`);
      setPayload((current) => append ? { ...next, conversations: [...current.conversations, ...next.conversations] } : next);
      if (!append) setSelectedId((current) => current && next.conversations.some((item) => item.id === current)
        ? current
        : next.conversations[0]?.id ?? null);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible cargar el inbox.");
    } finally {
      setLoading(false);
    }
  }, [assignmentFilter, search, statusFilter, tagFilter, unreadOnly]);

  const loadTemplates = useCallback(async () => {
    try {
      const response = await apiFetch<{ templates: WhatsAppTemplate[] }>("/api/whatsapp/templates?status=APPROVED");
      setTemplates(response.templates);
    } catch {
      setTemplates([]);
    }
  }, []);

  const loadDetail = useCallback(async (id: string, silent = false, before?: string) => {
    if (!silent) setDetailLoading(true);
    try {
      const next = await apiFetch<{ conversation: ConversationDetail }>(`/api/inbox/conversations/${id}${before ? `?before=${encodeURIComponent(before)}&limit=50` : "?limit=50"}`);
      setDetail((current) => before && current?.id === next.conversation.id
        ? { ...next.conversation, messages: [...next.conversation.messages, ...current.messages] }
        : next.conversation);
      if (detailIdRef.current !== next.conversation.id) {
        detailIdRef.current = next.conversation.id;
        setAssigneeId(next.conversation.assignment?.user?.id ?? "");
        setTeamId(next.conversation.assignment?.team?.id ?? "");
        setContactName(next.conversation.contact.name ?? "");
        setContactEmail(next.conversation.contact.email ?? "");
        setContactCompany(next.conversation.contact.company ?? "");
        setContactNotes(next.conversation.contact.notes ?? "");
      }
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible cargar la conversación.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(), 220);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  useEffect(() => { const timer = window.setTimeout(() => void loadTemplates(), 0); return () => window.clearTimeout(timer); }, [loadTemplates]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedId) void loadDetail(selectedId);
      else {
        detailIdRef.current = null;
        setDetail(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    const source = new EventSource("/api/inbox/events");
    source.addEventListener("ready", () => setRealtime(true));
    source.addEventListener("inbox", (event) => {
      setRealtime(true);
      void loadList();
      if (selectedId) {
        try {
          const changed = JSON.parse((event as MessageEvent<string>).data) as { conversationId?: string };
          if (!changed.conversationId || changed.conversationId === selectedId) void loadDetail(selectedId, true);
        } catch {
          void loadDetail(selectedId, true);
        }
      }
    });
    source.onerror = () => setRealtime(false);
    return () => source.close();
  }, [loadDetail, loadList, selectedId]);

  const messageScrollKey = detail ? `${detail.id}:${detail.messages.length}` : "";
  useEffect(() => {
    if (!messageScrollKey) return;
    const timer = window.setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 60);
    return () => window.clearTimeout(timer);
  }, [messageScrollKey]);

  const counts = useMemo(() => ({
    open: payload.conversations.filter((item) => item.status === "OPEN").length,
    unread: payload.conversations.reduce((total, item) => total + item.unreadCount, 0),
  }), [payload.conversations]);
  const availableTemplates = useMemo(() => templates.filter((template) => !detail || template.connection.id === detail.connection.id), [detail, templates]);
  const selectedTemplate = availableTemplates.find((template) => template.id === selectedTemplateId) ?? availableTemplates[0] ?? null;
  const effectiveTemplateVariables = Array.from({ length: selectedTemplate?.variableCount ?? 0 }, (_, index) => templateVariables[index] ?? "");

  async function changeStatus(status: ConversationStatus) {
    if (!detail) return;
    setBusy(true);
    try {
      await apiFetch(`/api/inbox/conversations/${detail.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      setDetail({ ...detail, status });
      await loadList();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible cambiar el estado.");
    } finally { setBusy(false); }
  }

  async function saveAssignment() {
    if (!detail) return;
    setBusy(true);
    try {
      const response = await apiFetch<{ assignment: Assignment | null }>(`/api/inbox/conversations/${detail.id}/assignment`, {
        method: "POST", body: JSON.stringify({ userId: assigneeId || null, teamId: teamId || null }),
      });
      setDetail({ ...detail, assignment: response.assignment });
      await loadList();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible asignar la conversación.");
    } finally { setBusy(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true); setError(undefined);
    try {
      let body: Record<string, unknown>;
      if (composerType === "text") body = { type: "text", text: { body: text.trim(), preview_url: true } };
      else if (composerType === "template") {
        if (!selectedTemplate) throw new Error("Sincroniza y selecciona una plantilla aprobada.");
        const components = effectiveTemplateVariables.length ? [{ type: "body", parameters: effectiveTemplateVariables.map((value) => ({ type: "text", text: value })) }] : undefined;
        body = { type: "template", template: { name: selectedTemplate.name, language: selectedTemplate.language, ...(components ? { components } : {}) } };
      } else {
        const media = {
          link: mediaLink.trim(),
          ...(composerType !== "audio" && mediaCaption.trim() ? { caption: mediaCaption.trim() } : {}),
          ...(composerType === "document" && mediaFilename.trim() ? { filename: mediaFilename.trim() } : {}),
        };
        body = { type: composerType, [composerType]: media };
      }
      await apiFetch(`/api/inbox/conversations/${detail.id}/messages`, { method: "POST", body: JSON.stringify(body) });
      setText(""); setMediaLink(""); setMediaCaption(""); setMediaFilename("");
      await Promise.all([loadDetail(detail.id, true), loadList()]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "No fue posible enviar el mensaje.");
      await loadDetail(detail.id, true);
    } finally { setBusy(false); }
  }

  async function retryMessage(messageId: string) {
    if (!detail) return;
    setBusy(true); setError(undefined);
    try {
      await apiFetch(`/api/inbox/messages/${messageId}/retry`, { method: "POST" });
      await Promise.all([loadDetail(detail.id, true), loadList()]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible reintentar el mensaje.");
      await loadDetail(detail.id, true);
    } finally { setBusy(false); }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !note.trim()) return;
    setBusy(true);
    try {
      const response = await apiFetch<{ note: InternalNote }>(`/api/inbox/conversations/${detail.id}/notes`, {
        method: "POST", body: JSON.stringify({ body: note.trim() }),
      });
      setDetail({ ...detail, notes: [response.note, ...detail.notes] });
      setNote("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible guardar la nota.");
    } finally { setBusy(false); }
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    try {
      await apiFetch(`/api/inbox/conversations/${detail.id}/contact`, {
        method: "PATCH",
        body: JSON.stringify({ name: contactName.trim(), email: contactEmail.trim(), company: contactCompany.trim(), notes: contactNotes.trim() }),
      });
      await Promise.all([loadDetail(detail.id, true), loadList()]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No fue posible actualizar el contacto.");
    } finally { setBusy(false); }
  }

  async function attachTag(tagId: string) {
    if (!detail || !tagId) return;
    try {
      await apiFetch(`/api/inbox/conversations/${detail.id}/tags`, { method: "POST", body: JSON.stringify({ tagId }) });
      await Promise.all([loadDetail(detail.id, true), loadList()]);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "No fue posible agregar la etiqueta."); }
  }

  async function removeTag(tagId: string) {
    if (!detail) return;
    try {
      await apiFetch(`/api/inbox/conversations/${detail.id}/tags/${tagId}`, { method: "DELETE" });
      setDetail({ ...detail, tags: detail.tags.filter((tag) => tag.id !== tagId) });
      await loadList();
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "No fue posible quitar la etiqueta."); }
  }

  async function createTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTagName.trim()) return;
    try {
      const response = await apiFetch<{ tag: Tag }>("/api/inbox/tags", {
        method: "POST", body: JSON.stringify({ name: newTagName.trim(), color: "#ff6b35" }),
      });
      setNewTagName("");
      await attachTag(response.tag.id);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "No fue posible crear la etiqueta."); }
  }

  return <section className="inbox-module">
    <header className="inbox-topbar">
      <div><p className="eyebrow">Centro de conversaciones</p><h1>Inbox</h1><span>{counts.open} abiertas · {counts.unread} sin leer</span></div>
      <div className="inbox-topbar-actions"><button className="button button-ghost button-small" type="button" onClick={() => setTemplateManagerOpen(true)}>Plantillas / nueva conversación</button><div className={`inbox-live ${realtime ? "online" : ""}`}><i />{realtime ? "Tiempo real conectado" : "Reconectando…"}</div></div>
    </header>
    {error && <div className="inbox-global-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(undefined)}>×</button></div>}
    <TemplateManager open={templateManagerOpen} canManage={payload.permissions.manageTemplates} onClose={() => setTemplateManagerOpen(false)} onTemplatesChanged={setTemplates} onConversationCreated={(conversationId) => { setTemplateManagerOpen(false); setSelectedId(conversationId); void loadList(); }} />
    <div className="inbox-grid">
      <aside className="inbox-conversations-panel">
        <div className="inbox-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar contacto o mensaje" /></div>
        <div className="inbox-filters">
          <select aria-label="Estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | ConversationStatus)}><option value="">Todos los estados</option><option value="OPEN">Abiertos</option><option value="PENDING">Pendientes</option><option value="RESOLVED">Resueltos</option></select>
          <select aria-label="Asignación" value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)}><option value="">Cualquier agente</option><option value="me">Asignadas a mí</option><option value="unassigned">Sin asignar</option>{payload.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select>
          <select aria-label="Etiqueta" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">Cualquier etiqueta</option>{payload.tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select>
          <label className="inbox-unread-filter"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} /> Solo no leídas</label>
        </div>
        <div className="inbox-conversation-list">
          {loading ? <div className="inbox-empty"><span className="spinner" />Cargando conversaciones…</div> : payload.conversations.length === 0 ? <div className="inbox-empty"><span>◎</span><strong>Tu inbox está listo</strong><p>Las conversaciones aparecerán aquí con los próximos webhooks de Meta.</p></div> : payload.conversations.map((conversation) => <button className={`inbox-conversation ${selectedId === conversation.id ? "active" : ""}`} type="button" onClick={() => setSelectedId(conversation.id)} key={conversation.id}>
            <span className="inbox-avatar">{initials(conversation.contact.name)}</span>
            <span className="inbox-conversation-copy"><strong>{conversation.contact.name}</strong><small>{conversation.lastMessagePreview ?? "Sin mensajes"}</small><span>{conversation.assignment?.user?.name ?? conversation.assignment?.teamName ?? "Sin asignar"}</span></span>
            <span className="inbox-conversation-meta"><time>{shortTime(conversation.lastMessageAt)}</time>{conversation.unreadCount > 0 && <b>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</b>}<i className={`conversation-state state-${conversation.status.toLowerCase()}`} title={statusLabels[conversation.status]} /></span>
          </button>)}
          {payload.nextCursor && <button className="inbox-load-more" type="button" onClick={() => void loadList(payload.nextCursor ?? undefined, true)}>Cargar más conversaciones</button>}
        </div>
      </aside>

      <main className="inbox-chat-panel">
        {!detail || detailLoading ? <div className="inbox-chat-empty">{detailLoading ? <><span className="spinner" />Cargando conversación…</> : <><span>↙</span><strong>Selecciona una conversación</strong><p>Consulta el historial y responde desde un solo lugar.</p></>}</div> : <>
          <header className="inbox-chat-header"><div><span className="inbox-avatar">{initials(detail.contact.name)}</span><div><strong>{detail.contact.name}</strong><small>+{detail.contact.waId} · {detail.connection.name}</small></div></div><select className={`inbox-status-select status-${detail.status.toLowerCase()}`} value={detail.status} disabled={busy || !payload.permissions.changeStatus} onChange={(event) => void changeStatus(event.target.value as ConversationStatus)}><option value="OPEN">Abierto</option><option value="PENDING">Pendiente</option><option value="RESOLVED">Resuelto</option></select></header>
          <div className="inbox-message-list">
            <div className="inbox-history-start">{detail.nextBefore ? <button type="button" onClick={() => void loadDetail(detail.id, true, detail.nextBefore ?? undefined)}>Cargar mensajes anteriores</button> : <><span>Inicio del historial disponible</span><small>Meta no permite importar conversaciones anteriores.</small></>}</div>
            {detail.messages.map((message) => <div className={`inbox-message-row ${message.direction.toLowerCase()}`} key={message.id}><article className={`inbox-message-bubble ${message.status === "FAILED" ? "message-failed" : ""}`}>{messageBody(message)}<footer><time>{shortTime(message.createdAt)}</time>{statusIndicator(message)}</footer>{message.error && <small className="inbox-message-error">{message.error}</small>}{message.status === "FAILED" && message.direction === "OUTBOUND" && payload.permissions.sendMessages && <button className="inbox-retry" type="button" disabled={busy} onClick={() => void retryMessage(message.id)}>Reintentar</button>}</article></div>)}
            <div ref={messagesEnd} />
          </div>
          <div className={`inbox-window-notice ${detail.window.open ? "open" : "closed"}`}><span>{detail.window.open ? "◷" : "⊘"}</span><p><strong>{detail.window.open ? "Ventana de atención abierta" : "Ventana de 24 horas cerrada"}</strong><small>{detail.window.open && detail.window.expiresAt ? `Puedes responder libremente hasta ${exactTime(detail.window.expiresAt)}.` : "Solo puedes enviar una plantilla aprobada por Meta."}</small></p></div>
          <form className="inbox-composer" onSubmit={sendMessage}>
            <div className="inbox-composer-tabs">{(["text", "template", "image", "document", "audio", "video"] as ComposerType[]).map((type) => <button className={composerType === type ? "active" : ""} type="button" key={type} onClick={() => setComposerType(type)} disabled={!payload.permissions.sendMessages || (!detail.window.open && type !== "template")}>{type === "text" ? "Texto" : type === "template" ? "Plantilla" : type === "image" ? "Imagen" : type === "document" ? "Documento" : type === "audio" ? "Audio" : "Video"}</button>)}</div>
            {composerType === "text" ? <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={4096} rows={3} placeholder="Escribe un mensaje…" required /> : composerType === "template" ? <div className="inbox-composer-fields"><select value={selectedTemplate?.id ?? ""} onChange={(event) => { const template = availableTemplates.find((item) => item.id === event.target.value); setSelectedTemplateId(event.target.value); setTemplateVariables(Array.from({ length: template?.variableCount ?? 0 }, () => "")); }} required><option value="" disabled>Selecciona plantilla aprobada</option>{availableTemplates.map((template) => <option value={template.id} key={template.id}>{template.name} · {template.language}</option>)}</select>{selectedTemplate?.preview && <p className="inbox-template-preview">{selectedTemplate.preview}</p>}{effectiveTemplateVariables.map((value, index) => <input value={value} key={index} onChange={(event) => setTemplateVariables((current) => effectiveTemplateVariables.map((item, itemIndex) => itemIndex === index ? event.target.value : current[itemIndex] ?? item))} placeholder={`Variable ${index + 1}`} required />)}</div> : <div className="inbox-composer-fields"><input type="url" value={mediaLink} onChange={(event) => setMediaLink(event.target.value)} placeholder="https://… URL pública del archivo" required />{composerType !== "audio" && <input value={mediaCaption} onChange={(event) => setMediaCaption(event.target.value)} maxLength={1024} placeholder="Descripción opcional" />}{composerType === "document" && <input value={mediaFilename} onChange={(event) => setMediaFilename(event.target.value)} maxLength={240} placeholder="Nombre del archivo" />}</div>}
            <div className="inbox-composer-footer"><span>{!payload.permissions.sendMessages ? "Sin permiso de envío" : composerType === "text" ? `${text.length}/4096` : "Envío seguro mediante Graph API"}</span><button className="button button-primary button-small" type="submit" disabled={busy || !payload.permissions.sendMessages || (!detail.window.open && composerType !== "template") || (composerType === "template" && !selectedTemplate)}>{busy ? "Enviando…" : "Enviar ↗"}</button></div>
          </form>
        </>}
      </main>

      <aside className="inbox-contact-panel">
        {!detail ? <div className="inbox-contact-empty">Selecciona un contacto para ver sus datos.</div> : <div className="inbox-contact-scroll">
          <section className="inbox-contact-hero"><span className="inbox-avatar large">{initials(detail.contact.name)}</span><h2>{detail.contact.name}</h2><p>+{detail.contact.waId}</p><div>{detail.tags.map((tag) => <button style={{ "--tag-color": tag.color } as React.CSSProperties} type="button" disabled={!payload.permissions.manageTags} onClick={() => void removeTag(tag.id)} key={tag.id}>{tag.name}{payload.permissions.manageTags ? " ×" : ""}</button>)}</div></section>
          <section className="inbox-side-section"><div className="inbox-side-title"><h3>Asignación</h3><span>{detail.assignment ? "Activa" : "Sin asignar"}</span></div><label>Agente<select value={assigneeId} disabled={!payload.permissions.assignConversations} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Ninguno</option>{payload.agents.filter((agent) => !teamId || payload.teams.find((team) => team.id === teamId)?.memberIds?.includes(agent.id)).map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label><label>Equipo<select value={teamId} disabled={!payload.permissions.assignConversations} onChange={(event) => { setTeamId(event.target.value); setAssigneeId(""); }}><option value="">Ninguno</option>{payload.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label><button className="button button-ghost button-small" type="button" disabled={busy || !payload.permissions.assignConversations} onClick={() => void saveAssignment()}>Guardar asignación</button></section>
          <section className="inbox-side-section"><div className="inbox-side-title"><h3>Etiquetas</h3></div><select defaultValue="" disabled={!payload.permissions.manageTags} onChange={(event) => { void attachTag(event.target.value); event.target.value = ""; }}><option value="" disabled>Agregar etiqueta…</option>{payload.tags.filter((tag) => !detail.tags.some((current) => current.id === tag.id)).map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select><form className="inbox-inline-form" onSubmit={createTag}><input value={newTagName} disabled={!payload.permissions.manageTags} onChange={(event) => setNewTagName(event.target.value)} placeholder="Nueva etiqueta" maxLength={80} /><button type="submit" disabled={!payload.permissions.manageTags}>＋</button></form></section>
          <section className="inbox-side-section"><div className="inbox-side-title"><h3>Datos del contacto</h3></div><form className="inbox-contact-form" onSubmit={saveContact}><label>Nombre<input value={contactName} disabled={!payload.permissions.editContacts} onChange={(event) => setContactName(event.target.value)} required /></label><label>Correo<input type="email" value={contactEmail} disabled={!payload.permissions.editContacts} onChange={(event) => setContactEmail(event.target.value)} placeholder="correo@empresa.com" /></label><label>Empresa<input value={contactCompany} disabled={!payload.permissions.editContacts} onChange={(event) => setContactCompany(event.target.value)} /></label><label>Contexto<textarea rows={3} value={contactNotes} disabled={!payload.permissions.editContacts} onChange={(event) => setContactNotes(event.target.value)} /></label><button className="button button-ghost button-small" type="submit" disabled={busy || !payload.permissions.editContacts}>Guardar contacto</button></form></section>
          <section className="inbox-side-section inbox-notes"><div className="inbox-side-title"><h3>Notas internas</h3><span>Solo equipo</span></div><form onSubmit={addNote}><textarea rows={3} value={note} disabled={!payload.permissions.addNotes} onChange={(event) => setNote(event.target.value)} placeholder="Añade contexto para el equipo…" maxLength={10000} required /><button className="button button-secondary button-small" type="submit" disabled={busy || !payload.permissions.addNotes}>Agregar nota</button></form><div className="inbox-note-list">{detail.notes.map((item) => <article key={item.id}><p>{item.body}</p><footer>{item.author.name} · {exactTime(item.createdAt)}</footer></article>)}{detail.notes.length === 0 && <small>Aún no hay notas internas.</small>}</div></section>
        </div>}
      </aside>
    </div>
  </section>;
}
