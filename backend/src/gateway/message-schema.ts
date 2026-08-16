import { z } from "zod";

const destinationSchema = z.string().trim().min(7).max(32).transform((value, context) => {
  const normalized = value.replace(/[\s()+.\-]/g, "");
  if (!/^\d{7,20}$/.test(normalized)) {
    context.addIssue({ code: "custom", message: "El número debe incluir código de país y solo dígitos." });
    return z.NEVER;
  }
  return normalized;
});

const base = {
  connection_id: z.string().min(1).max(30).optional(),
  to: destinationSchema,
};

const textMessageSchema = z.object({
  ...base,
  type: z.literal("text"),
  text: z.object({
    body: z.string().min(1).max(4096),
    preview_url: z.boolean().optional(),
  }),
}).strict();

const templateMessageSchema = z.object({
  ...base,
  type: z.literal("template"),
  template: z.object({
    name: z.string().regex(/^[a-z0-9_]+$/).max(512),
    language: z.union([
      z.string().min(2).max(35).transform((code) => ({ code })),
      z.object({ code: z.string().min(2).max(35), policy: z.string().max(35).optional() }).strict(),
    ]),
    components: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  }).strict(),
}).strict();

const mediaReference = z.object({
  id: z.string().min(1).max(512).optional(),
  link: z.url().max(2048).optional(),
}).refine((value) => Boolean(value.id) !== Boolean(value.link), {
  message: "Indica exactamente uno de id o link.",
});

const imageMessageSchema = z.object({
  ...base,
  type: z.literal("image"),
  image: mediaReference.extend({ caption: z.string().max(1024).optional() }),
}).strict();

const documentMessageSchema = z.object({
  ...base,
  type: z.literal("document"),
  document: mediaReference.extend({
    caption: z.string().max(1024).optional(),
    filename: z.string().min(1).max(240).optional(),
  }),
}).strict();

const audioMessageSchema = z.object({
  ...base,
  type: z.literal("audio"),
  audio: mediaReference,
}).strict();

const videoMessageSchema = z.object({
  ...base,
  type: z.literal("video"),
  video: mediaReference.extend({ caption: z.string().max(1024).optional() }),
}).strict();

export const outboundMessageSchema = z.discriminatedUnion("type", [
  textMessageSchema,
  templateMessageSchema,
  imageMessageSchema,
  documentMessageSchema,
  audioMessageSchema,
  videoMessageSchema,
]);

export type OutboundMessageInput = z.infer<typeof outboundMessageSchema>;

export function metaPayload(message: OutboundMessageInput): Record<string, unknown> {
  const { connection_id: _connectionId, ...content } = message;
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...content,
  };
}
