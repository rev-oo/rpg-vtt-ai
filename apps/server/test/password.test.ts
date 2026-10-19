import { describe, expect, it } from 'vitest';

import { generatePassword, hashPassword, verifyPassword } from '../src/domain/auth/password.js';

describe('password hashing', () => {
  it('hashes with Argon2id and verifies the right password only', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('generates distinct one-time passwords', () => {
    const a = generatePassword();
    expect(a).toMatch(/^[\w-]{16}$/);
    expect(generatePassword()).not.toBe(a);
  });
});
