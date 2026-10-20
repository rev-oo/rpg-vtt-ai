import type { ChatMessage } from '@vtt/shared/api';

/** One page of history as the API returns it: newest first. */
export interface ChatPage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

/**
 * Adds messages to a chronological list, skipping ones already there (a message can arrive
 * from both the socket and a REST response). The sort is stable, so messages sent within
 * the same millisecond keep their arrival order.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const known = new Set(current.map((m) => m.id));
  const added = incoming.filter((m) => {
    if (known.has(m.id)) return false;
    known.add(m.id);
    return true;
  });
  if (added.length === 0) return [...current];
  return [...current, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
