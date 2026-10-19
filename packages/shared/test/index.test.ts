import { describe, expect, it } from 'vitest';

import { packageName } from '../src/index.js';

describe('@vtt/shared', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@vtt/shared');
  });
});
