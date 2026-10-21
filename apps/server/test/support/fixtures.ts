import type { Db } from '../../src/db/client.js';
import { plugins, users } from '../../src/db/schema.js';
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

/** Inserts a ready, enabled plugin row with no folder, as if the scanner had found it. */
export function insertPlugin(
  db: Db,
  overrides: Partial<typeof plugins.$inferInsert> = {},
): typeof plugins.$inferSelect {
  return db
    .insert(plugins)
    .values({
      id: 'test-system',
      name: 'Test System',
      version: '1.2.0',
      enabled: true,
      actorTypes: { character: { controlledBy: 'player' }, npc: { controlledBy: 'gm' } },
      itemTypes: ['weapon', 'consumable'],
      ...overrides,
    })
    .returning()
    .get();
}
