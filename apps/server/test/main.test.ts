import { describe, expect, it } from 'vitest';

import { packageName } from '../src/main.js';

describe('@vtt/server', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@vtt/server');
  });
});
