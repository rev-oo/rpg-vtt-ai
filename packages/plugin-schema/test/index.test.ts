import { describe, expect, it } from 'vitest';

import { packageName } from '../src/index.js';

describe('@vtt/plugin-schema', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@vtt/plugin-schema');
  });
});
