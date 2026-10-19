import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { sessions, users } from '../src/db/schema.js';
import { SessionService } from '../src/domain/auth/sessions.js';
import { hashToken } from '../src/domain/auth/tokens.js';

import { createTestDb } from './support/db.js';
import { insertUser } from './support/fixtures.js';

function setup(ttlSeconds = 3600) {
  const db = createTestDb();
  let now = new Date('2026-01-01T00:00:00Z');
  const service = new SessionService({ db, ttlSeconds, now: () => now });
  const user = insertUser(db);
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  return { db, service, user, advance };
}

describe('SessionService', () => {
  it('creates a session that validates to its user', () => {
    const { service, user } = setup();
    const issued = service.create(user.id);

    const session = service.validate(issued.token);
    expect(session?.user.id).toBe(user.id);
    expect(session?.csrfToken).toBe(issued.csrfToken);
    expect(issued.expiresAt.toISOString()).toBe('2026-01-01T01:00:00.000Z');
  });

  it('stores only the token hash', () => {
    const { db, service, user } = setup();
    const { token } = service.create(user.id);

    const ids = db.select({ id: sessions.id }).from(sessions).all();
    expect(ids).toEqual([{ id: hashToken(token) }]);
    expect(ids[0]?.id).not.toBe(token);
  });

  it('rejects unknown tokens', () => {
    const { service } = setup();
    expect(service.validate('nope')).toBeNull();
  });

  it('rejects and deletes expired sessions', () => {
    const { db, service, user, advance } = setup(60);
    const { token } = service.create(user.id);

    advance(59_999);
    expect(service.validate(token)).not.toBeNull();
    advance(1);
    expect(service.validate(token)).toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it('rejects sessions of disabled users', () => {
    const { db, service, user } = setup();
    const { token } = service.create(user.id);
    db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, user.id)).run();

    expect(service.validate(token)).toBeNull();
  });

  it('rotates: the previous token stops working', () => {
    const { service, user } = setup();
    const first = service.create(user.id);
    const second = service.rotate(first.token, user.id);

    expect(service.validate(first.token)).toBeNull();
    expect(service.validate(second.token)?.user.id).toBe(user.id);
    expect(second.token).not.toBe(first.token);
  });

  it('revokes all sessions of a user except the current one', () => {
    const { service, user } = setup();
    const keep = service.create(user.id);
    const other = service.create(user.id);
    const keepId = service.validate(keep.token)?.id;

    service.revokeAllForUser(user.id, keepId);
    expect(service.validate(keep.token)).not.toBeNull();
    expect(service.validate(other.token)).toBeNull();

    service.revokeAllForUser(user.id);
    expect(service.validate(keep.token)).toBeNull();
  });

  it('purges expired rows', () => {
    const { service, user, advance } = setup(60);
    service.create(user.id);
    advance(30_000);
    const fresh = service.create(user.id);
    advance(30_000);

    expect(service.purgeExpired()).toBe(1);
    expect(service.validate(fresh.token)).not.toBeNull();
  });
});
