import { randomBytes } from 'node:crypto';

import { hash, verify, type Algorithm } from '@node-rs/argon2';

// `Algorithm` is an ambient const enum, which `verbatimModuleSyntax` cannot read at runtime.
const ARGON2ID = 2 satisfies Algorithm.Argon2id;

/** Argon2id with the OWASP-recommended minimums (19 MiB, 2 iterations, 1 lane) (FR-AUTH-03). */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Returns false for a wrong password or a malformed hash; never throws. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A random, typeable one-time password for admin-created users (FR-AUTH-02). */
export function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}
