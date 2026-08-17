export interface InboxRealtimeEvent {
  type: "conversation.updated" | "message.updated" | "note.created" | "assignment.updated" | "tag.updated";
  conversationId?: string;
  at: string;
}

type Subscriber = (event: InboxRealtimeEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();
const redisChannel = "thagencia:inbox:v1";
const instanceId = randomUUID();
let publisher: RedisClientType | undefined;
let subscriber: RedisClientType | undefined;
let publisherReady: Promise<RedisClientType | null> | undefined;
let subscriberReady: Promise<void> | undefined;

function deliverLocal(tenantId: string, event: InboxRealtimeEvent): void {
  const listeners = subscribers.get(tenantId);
  if (!listeners?.size) return;
  for (const listener of listeners) listener(event);
}

function ensurePublisher(): Promise<RedisClientType | null> {
  const redisUrl = env.redisUrl;
  if (!redisUrl) return Promise.resolve(null);
  publisherReady ??= (async () => {
    const client = createClient({ url: redisUrl });
    client.on("error", () => undefined);
    await client.connect();
    publisher = client as RedisClientType;
    return publisher;
  })().catch(() => null);
  return publisherReady;
}

function ensureSubscriber(): void {
  const redisUrl = env.redisUrl;
  if (!redisUrl || subscriberReady) return;
  subscriberReady = (async () => {
    const client = createClient({ url: redisUrl });
    client.on("error", () => undefined);
    await client.connect();
    subscriber = client as RedisClientType;
    await subscriber.subscribe(redisChannel, (raw) => {
      try {
        const message = JSON.parse(raw) as { instanceId: string; tenantId: string; event: InboxRealtimeEvent };
        if (message.instanceId !== instanceId) deliverLocal(message.tenantId, message.event);
      } catch {
        // Se ignoran mensajes ajenos o corruptos del canal compartido.
      }
    });
  })().catch(() => undefined);
}

export function publishInboxEvent(
  tenantId: bigint,
  event: Omit<InboxRealtimeEvent, "at">,
): void {
  const payload: InboxRealtimeEvent = { ...event, at: new Date().toISOString() };
  const tenantKey = tenantId.toString();
  deliverLocal(tenantKey, payload);
  if (env.redisUrl) {
    void ensurePublisher().then((client) => client?.publish(redisChannel, JSON.stringify({ instanceId, tenantId: tenantKey, event: payload }))).catch(() => undefined);
  }
}

export function subscribeToInbox(tenantId: bigint, subscriber: Subscriber): () => void {
  ensureSubscriber();
  const key = tenantId.toString();
  const listeners = subscribers.get(key) ?? new Set<Subscriber>();
  listeners.add(subscriber);
  subscribers.set(key, listeners);
  return () => {
    listeners.delete(subscriber);
    if (listeners.size === 0) subscribers.delete(key);
  };
}

export async function closeInboxRealtime(): Promise<void> {
  await Promise.allSettled([
    publisher?.isOpen ? publisher.quit() : Promise.resolve(),
    subscriber?.isOpen ? subscriber.quit() : Promise.resolve(),
  ]);
}
import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

import { env } from "../config/env.js";
