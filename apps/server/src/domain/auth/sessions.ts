import { and, eq, lte, ne } from 'drizzle-orm';

import type { Db } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';

import { generateToken, hashToken } from './tokens.js';

export type SessionUser = Pick<
  typeof users.$inferSelect,
  'id' | 'username' | 'displayName' | 'isAdmin' | 'mustChangePassword'
>;

export interface ActiveSession {
  /** Hashed session id (never the raw token). */
  id: string;
  csrfToken: string;
  expiresAt: Date;
  user: SessionUser;
}

export interface IssuedSession {
  /** Raw token for the cookie. Not stored anywhere on the server. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface SessionServiceOptions {
  db: Db;
  /** Lifetime of new sessions; a function reads it again for every session (FR-ADMIN-01). */
  ttlSeconds: number | (() => number);
  now?: () => Date;
}

/** Server-side session records with expiry (FR-AUTH-04). */
export class SessionService {
  readonly #db: Db;
  readonly #ttlSeconds: () => number;
  readonly #now: () => Date;

  constructor({ db, ttlSeconds, now = () => new Date() }: SessionServiceOptions) {
    this.#db = db;
    this.#ttlSeconds = typeof ttlSeconds === 'number' ? () => ttlSeconds : ttlSeconds;
    this.#now = now;
  }

  create(userId: string): IssuedSession {
    const token = generateToken();
    const csrfToken = generateToken();
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + this.#ttlSeconds() * 1000);
    this.#db
      .insert(sessions)
      .values({ id: hashToken(token), userId, csrfToken, createdAt: now, expiresAt })
      .run();
    return { token, csrfToken, expiresAt };
  }

  /**
   * Issues a fresh session on login and drops the one the client presented, so a session id
   * fixed before login is never upgraded.
   */
  rotate(previousToken: string | undefined, userId: string): IssuedSession {
    if (previousToken) this.revoke(previousToken);
    return this.create(userId);
  }

  /** Returns the session for a raw token, or null if unknown, expired or the user is disabled. */
  validate(token: string): ActiveSession | null {
    const id = hashToken(token);
    const row = this.#db
      .select({
        id: sessions.id,
        csrfToken: sessions.csrfToken,
        expiresAt: sessions.expiresAt,
        disabledAt: users.disabledAt,
        user: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          isAdmin: users.isAdmin,
          mustChangePassword: users.mustChangePassword,
        },
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id))
      .get();
    if (!row) return null;
    if (row.expiresAt.getTime() <= this.#now().getTime()) {
      this.#db.delete(sessions).where(eq(sessions.id, id)).run();
      return null;
    }
    if (row.disabledAt) return null;
    return { id: row.id, csrfToken: row.csrfToken, expiresAt: row.expiresAt, user: row.user };
  }

  revoke(token: string): void {
    this.#db
      .delete(sessions)
      .where(eq(sessions.id, hashToken(token)))
      .run();
  }

  /** Ends every session of a user, optionally keeping the current one (e.g. password change). */
  revokeAllForUser(userId: string, exceptSessionId?: string): void {
    const condition = exceptSessionId
      ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
      : eq(sessions.userId, userId);
    this.#db.delete(sessions).where(condition).run();
  }

  /** Deletes expired session rows; returns how many were removed. */
  purgeExpired(): number {
    return this.#db.delete(sessions).where(lte(sessions.expiresAt, this.#now())).run().changes;
  }
}
