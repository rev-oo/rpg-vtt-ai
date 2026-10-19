import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** A 256-bit random token, URL- and cookie-safe. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored hashed so a database leak does not leak live sessions or invites. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateId(): string {
  return randomUUID();
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
