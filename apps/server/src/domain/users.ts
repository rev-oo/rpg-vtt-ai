import { count, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../db/client.js';
import { users } from '../db/schema.js';
import { conflict } from '../errors.js';

import { hashPassword } from './auth/password.js';
import type { SessionUser } from './auth/sessions.js';
import { generateId } from './auth/tokens.js';

export type User = typeof users.$inferSelect;

/** The user fields that may leave the server. */
export type PublicUser = SessionUser;

export function toPublicUser(user: SessionUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    mustChangePassword: user.mustChangePassword,
  };
}

export interface NewUserInput {
  username: string;
  displayName: string;
  password: string;
  isAdmin?: boolean;
  mustChangePassword?: boolean;
}

export async function prepareUser(input: NewUserInput): Promise<typeof users.$inferInsert> {
  return {
    id: generateId(),
    username: input.username,
    displayName: input.displayName,
    passwordHash: await hashPassword(input.password),
    isAdmin: input.isAdmin ?? false,
    mustChangePassword: input.mustChangePassword ?? false,
  };
}

/** Inserts a prepared user; a taken username (case-insensitive) is a 409. */
export function insertUser(db: DbOrTx, user: typeof users.$inferInsert): User {
  try {
    return db.insert(users).values(user).returning().get();
  } catch (error) {
    if (error instanceof Error && error.message.includes('users_username_unique')) {
      throw conflict('username_taken', 'That username is already taken.');
    }
    throw error;
  }
}

export function findUserByUsername(db: DbOrTx, username: string): User | undefined {
  return db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
    .get();
}

export function countUsers(db: DbOrTx): number {
  return db.select({ n: count() }).from(users).get()?.n ?? 0;
}
