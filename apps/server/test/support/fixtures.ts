import type { Db } from '../../src/db/client.js';
import { users } from '../../src/db/schema.js';
import { generateId } from '../../src/domain/auth/tokens.js';

type NewUser = typeof users.$inferInsert;

/** Inserts a user with a placeholder hash; use hashPassword() when a login is needed. */
export function insertUser(db: Db, overrides: Partial<NewUser> = {}): typeof users.$inferSelect {
  const id = overrides.id ?? generateId();
  return db
    .insert(users)
    .values({
      id,
      username: `user-${id.slice(0, 8)}`,
      displayName: 'Test User',
      passwordHash: 'not-a-real-hash',
      ...overrides,
    })
    .returning()
    .get();
}
