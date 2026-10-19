import { isGmLike, type Subject } from './ownership.js';

/** Message audiences (FR-CHAT-02). */
export const AUDIENCES = ['public', 'whisper', 'gm'] as const;
export type Audience = (typeof AUDIENCES)[number];

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
