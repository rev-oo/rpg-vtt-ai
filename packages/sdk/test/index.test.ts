import { describe, expect, it } from 'vitest';

import { defineServer, defineShared, packageName } from '../src/index.js';

describe('@vtt/sdk', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@vtt/sdk');
  });

  it('returns shared and server definitions as given', () => {
    const shared = { functions: { double: (x: unknown) => (typeof x === 'number' ? x * 2 : 0) } };
    expect(defineShared(shared)).toBe(shared);
    const server = { handlers: { attack: () => undefined } };
    expect(defineServer(server)).toBe(server);
  });
});
