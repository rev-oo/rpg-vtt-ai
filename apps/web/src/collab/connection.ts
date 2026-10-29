import { collabServerMessage, type CollabServerMessage } from '@vtt/shared/api';

// What every live document on `/ws/collab` shares (specs §9).

export function collabUrl(): string {
  const url = new URL('/ws/collab', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function parseMessage(payload: string): CollabServerMessage | undefined {
  try {
    const parsed = collabServerMessage.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Reasons the server gives when it closes a document (@hocuspocus/common). */
export const REVOKED = new Set(['Forbidden', 'Unauthorized']);
