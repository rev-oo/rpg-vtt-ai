import { z } from 'zod';

import { AUDIENCES } from '../permissions/chat.js';

import {
  CHAT_PAGE_SIZE,
  MAX_CHAT_PAGE_SIZE,
  MAX_CHAT_TEXT,
  MAX_WHISPER_RECIPIENTS,
} from './constants.js';

// Chat (FR-CHAT-01, 02, 07). Text messages come from users; roll and card messages are only
// ever created by the server (FR-CHAT-03, M3).

export const MESSAGE_KINDS = ['text', 'roll', 'card'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** `POST /tables/:id/messages` and the `chat.send` socket event. */
export const chatSendBody = z
  .object({
    text: z.string().trim().min(1).max(MAX_CHAT_TEXT),
    audience: z.enum(AUDIENCES).default('public'),
    /** Whisper recipients (user ids); required for whispers, ignored otherwise. */
    recipientIds: z.array(z.uuid()).max(MAX_WHISPER_RECIPIENTS).default([]),
    /** Speak as one of your actors (FR-CHAT-01); `null` speaks as yourself. */
    actorId: z.uuid().nullable().default(null),
  })
  .refine((body) => body.audience !== 'whisper' || body.recipientIds.length > 0, {
    message: 'A whisper needs at least one recipient.',
    path: ['recipientIds'],
  });
export type ChatSendInput = z.input<typeof chatSendBody>;

/** `GET /tables/:id/messages?before=…&limit=…`: newest first. */
export const chatHistoryQuery = z.object({
  /** The `nextCursor` of the previous page. */
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_CHAT_PAGE_SIZE).default(CHAT_PAGE_SIZE),
});
export type ChatHistoryQuery = z.input<typeof chatHistoryQuery>;

/** Who spoke, as it was when the message was sent; survives renames and deletions. */
export const speakerSchema = z.object({
  name: z.string(),
  actorId: z.string().nullable(),
  imageUrl: z.string().nullable(),
});
export type Speaker = z.infer<typeof speakerSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  /** `null` once the sender's account is deleted (FR-AUTH-06). */
  senderId: z.string().nullable(),
  speaker: speakerSchema,
  audience: z.enum(AUDIENCES),
  recipientIds: z.array(z.string()),
  kind: z.enum(MESSAGE_KINDS),
  text: z.string(),
  rolls: z.array(z.unknown()),
  card: z.unknown().nullable(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatMessageResponseSchema = z.object({ message: chatMessageSchema });
export const chatHistoryResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
  /** Pass as `before` to load older messages; `null` at the start of the table. */
  nextCursor: z.string().nullable(),
});
