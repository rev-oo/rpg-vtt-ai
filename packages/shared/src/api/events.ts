import { z } from 'zod';

import { chatMessageSchema, chatSendBody, rollRequestBody } from './chat.js';

// The events WebSocket at /ws/events (specs §10.2). Every message is an envelope
// `{ v, type, tableId?, payload?, id? }`; the server answers a client message that carries an
// `id` with `ack` or `error` referring to it.

export const EVENTS_PROTOCOL_VERSION = 1;
export const SUPPORTED_PROTOCOL_VERSIONS = [EVENTS_PROTOCOL_VERSION] as const;
/** The server pings every socket this often and drops those that do not answer. */
export const HEARTBEAT_INTERVAL_MS = 25_000;
/** Largest client message, in bytes. */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;

const clientBase = {
  v: z.literal(EVENTS_PROTOCOL_VERSION),
  /** Correlates the server's `ack` or `error`. */
  id: z.string().min(1).max(64).optional(),
};

export const clientEventSchema = z.discriminatedUnion('type', [
  z.object({ ...clientBase, type: z.literal('subscribe'), tableId: z.uuid() }),
  z.object({ ...clientBase, type: z.literal('unsubscribe'), tableId: z.uuid() }),
  z.object({
    ...clientBase,
    type: z.literal('chat.send'),
    tableId: z.uuid(),
    payload: chatSendBody,
  }),
  z.object({
    ...clientBase,
    type: z.literal('roll.request'),
    tableId: z.uuid(),
    payload: rollRequestBody,
  }),
  z.object({ ...clientBase, type: z.literal('presence.ping'), tableId: z.uuid().optional() }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ClientEventInput = z.input<typeof clientEventSchema>;

export const ENTITY_KINDS = ['actor', 'item'] as const;
export const ENTITY_CHANGES = ['created', 'updated', 'deleted', 'restored'] as const;

/** An entity changed; clients refetch it over REST (FR-ENT-07). */
export const entityChangedPayload = z.object({
  kind: z.enum(ENTITY_KINDS),
  id: z.string(),
  change: z.enum(ENTITY_CHANGES),
  /** For owned items, the actor that owns them. */
  actorId: z.string().nullable(),
});
export type EntityChanged = z.infer<typeof entityChangedPayload>;

const serverBase = {
  v: z.literal(EVENTS_PROTOCOL_VERSION),
  /** Unique per server message. */
  id: z.string(),
};

export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ ...serverBase, type: z.literal('ack'), payload: z.object({ replyTo: z.string() }) }),
  z.object({
    ...serverBase,
    type: z.literal('error'),
    payload: z.object({
      code: z.string(),
      message: z.string(),
      replyTo: z.string().nullable(),
      /** Present when the client spoke an unsupported protocol version. */
      supportedVersions: z.array(z.number()).optional(),
    }),
  }),
  z.object({
    ...serverBase,
    type: z.literal('entity.changed'),
    tableId: z.string(),
    payload: entityChangedPayload,
  }),
  z.object({
    ...serverBase,
    type: z.literal('chat.message'),
    tableId: z.string(),
    payload: z.object({ message: chatMessageSchema }),
  }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
