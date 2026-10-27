import type { TableRole } from '../roles.js';

import { isGmLike, type Subject } from './ownership.js';

/** Message audiences (FR-CHAT-02). */
export const AUDIENCES = ['public', 'whisper', 'gm'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Spectators read chat but never post (§2). */
export function canSendChat(role: TableRole): boolean {
  return role !== 'spectator';
}

export interface MessageAudience {
  audience: Audience;
  senderId: string;
  /** Whisper recipients; ignored for other audiences. */
  recipientIds: readonly string[];
}

/**
 * Whether a member may receive a message, on delivery and in history (specs §10.2):
 * whispers reach only the sender and recipients; `gm` messages reach GMs and assistants, and
 * the sender sees their own secret roll (FR-CHAT-05).
 */
export function canSeeAudience(subject: Subject, message: MessageAudience): boolean {
  if (subject.userId === message.senderId) return true;
  switch (message.audience) {
    case 'public':
      return true;
    case 'whisper':
      return message.recipientIds.includes(subject.userId);
    case 'gm':
      return isGmLike(subject.role);
  }
}

/** How long authors may edit or delete their messages (FR-CHAT-09). */
export const CHAT_EDIT_WINDOW_MS = 5 * 60 * 1000;

/** What decides who may change a message: its author, its kind and when it was sent. */
export interface MessageAuthorship {
  senderId: string | null;
  /** Only `text` messages are the author's words; rolls and cards come from the server. */
  kind: string;
  /** Unix milliseconds. */
  sentAt: number;
}

/** Authors edit their own text messages for 5 minutes (FR-CHAT-09, ADR-052). */
export function canEditMessage(subject: Subject, message: MessageAuthorship, now: number): boolean {
  return (
    message.kind === 'text' &&
    message.senderId === subject.userId &&
    now - message.sentAt < CHAT_EDIT_WINDOW_MS
  );
}

/**
 * Authors delete what they may edit; GMs and assistants delete any message they can see
 * (FR-CHAT-09, ADR-052).
 */
export function canDeleteMessage(
  subject: Subject,
  message: MessageAuthorship,
  now: number,
): boolean {
  return isGmLike(subject.role) || canEditMessage(subject, message, now);
}
