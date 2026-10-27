import { z } from 'zod';

import { AUDIENCES } from '../permissions/chat.js';

import {
  CHAT_PAGE_SIZE,
  MAX_CHAT_PAGE_SIZE,
  MAX_CHAT_TEXT,
  MAX_FORMULA_LENGTH,
  MAX_WHISPER_RECIPIENTS,
} from './constants.js';
import { rollSchema } from './rolls.js';

// Chat (FR-CHAT-01, 02, 07). Text messages come from users; roll and card messages are only
// ever created by the server (FR-CHAT-03).

export const MESSAGE_KINDS = ['text', 'roll', 'card'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Who a posted message reaches, and who speaks it. */
const messageTarget = {
  audience: z.enum(AUDIENCES).default('public'),
  /** Whisper recipients (user ids); required for whispers, ignored otherwise. */
  recipientIds: z.array(z.uuid()).max(MAX_WHISPER_RECIPIENTS).default([]),
  /** Speak as one of your actors (FR-CHAT-01); `null` speaks as yourself. */
  actorId: z.uuid().nullable().default(null),
};

const hasRecipients = (body: { audience: string; recipientIds: string[] }): boolean =>
  body.audience !== 'whisper' || body.recipientIds.length > 0;
const whisperRule = {
  message: 'A whisper needs at least one recipient.',
  path: ['recipientIds'],
};

/** `POST /tables/:id/messages` and the `chat.send` socket event. */
export const chatSendBody = z
  .object({ text: z.string().trim().min(1).max(MAX_CHAT_TEXT), ...messageTarget })
  .refine(hasRecipients, whisperRule);
export type ChatSendInput = z.input<typeof chatSendBody>;

/** A recipe argument from a sheet's roll button (specs §8.7): `@args.<name>`. */
const rollArg = z.union([z.number(), z.string().max(200), z.boolean()]);

/**
 * `POST /tables/:id/rolls` and the `roll.request` socket event: a formula typed by a user
 * (FR-CHAT-03, 08), or a roll recipe of the table's system with its arguments (ADR-025).
 * With `actorId`, references read that actor's data (FR-DICE-02); recipes need one.
 */
export const rollRequestBody = z
  .object({
    formula: z.string().trim().min(1).max(MAX_FORMULA_LENGTH).optional(),
    recipe: z
      .object({
        name: z.string().min(1).max(64),
        args: z.record(z.string().max(64), rollArg).default({}),
      })
      .optional(),
    ...messageTarget,
  })
  .refine((body) => (body.formula === undefined) !== (body.recipe === undefined), {
    message: 'Send either a formula or a recipe.',
    path: ['formula'],
  })
  .refine(hasRecipients, whisperRule);
export type RollRequestInput = z.input<typeof rollRequestBody>;

/** Slash commands the chat handles itself; plugins cannot declare them (FR-CHAT-08). */
export const BUILT_IN_COMMANDS = ['r', 'gmr'] as const;

/** A slash command's name, as typed after the `/`. */
export const COMMAND_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * `POST /tables/:id/commands`: a slash command of the table's system (FR-PLUGIN-10, ADR-048).
 * `args` is the text after the name; the plugin's server code reads it. The audience and
 * speaker work as for rolls.
 */
export const commandRequestBody = z
  .object({
    name: z.string().regex(COMMAND_NAME),
    args: z.string().trim().max(MAX_CHAT_TEXT).default(''),
    ...messageTarget,
  })
  .refine(hasRecipients, whisperRule);
export type CommandRequestInput = z.input<typeof commandRequestBody>;

/** One row of a resolved chat card (specs §8.11). */
export const cardRowSchema = z.object({
  label: z.string(),
  value: z.string(),
  class: z.string().optional(),
  /** Why the row's formula failed. */
  error: z.string().optional(),
});

/**
 * The `card` of a recipe roll message: what the plugin engine resolved when it rolled.
 * Texts are the plugin's lang keys; `text` of the message is the plain-text fallback
 * (FR-CHAT-06).
 */
export const recipeCardSchema = z.object({
  /** The system plugin that rolled it. */
  system: z.string(),
  recipe: z.string(),
  label: z.string().nullable(),
  outcome: z
    .object({ index: z.number().int(), label: z.string(), class: z.string().optional() })
    .nullable(),
  card: z
    .object({
      name: z.string(),
      title: z.string(),
      rows: z.array(cardRowSchema),
      outcome: z.boolean(),
    })
    .nullable(),
});
export type RecipeCard = z.infer<typeof recipeCardSchema>;

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
  /** The rolls of a `roll` message; empty for other kinds. */
  rolls: z.array(rollSchema),
  /** Set on `card` messages. */
  card: recipeCardSchema.nullable(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatMessageResponseSchema = z.object({ message: chatMessageSchema });
export const chatHistoryResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
  /** Pass as `before` to load older messages; `null` at the start of the table. */
  nextCursor: z.string().nullable(),
});
