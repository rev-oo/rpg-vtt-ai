import { describe, expect, it } from 'vitest';

import { sharedEngineFunctions } from '../src/plugin-host/shared-engine.js';

import { loadEngineFromDisk } from './support/quickjs.js';

loadEngineFromDisk();

describe('shared code in the browser (T-1502)', () => {
  it('runs the functions in the engine, synchronously, with values as JSON', async () => {
    const functions = await sharedEngineFunctions(
      'export default { functions: { twice: (x) => x * 2, pair: (a, b) => [a, b] } };',
    );
    expect(functions.twice?.(21)).toBe(42);
    expect(functions.pair?.('a', true)).toEqual(['a', true]);
  });

  it('checks the default export', async () => {
    await expect(sharedEngineFunctions('export default { functions: {} };')).resolves.toEqual({});
    await expect(sharedEngineFunctions('export default {};')).resolves.toEqual({});
    await expect(
      sharedEngineFunctions('export default { functions: { twice: 2 } };'),
    ).rejects.toThrow('defineShared');
    await expect(sharedEngineFunctions('export const x = 1;')).rejects.toThrow('defineShared');
    await expect(sharedEngineFunctions('throw new Error("boom");')).rejects.toThrow('boom');
  });

  it('has no page, cookies or network', async () => {
    const functions = await sharedEngineFunctions(`export default { functions: {
      reach: () => [typeof document, typeof window, typeof fetch, typeof XMLHttpRequest].join()
    } };`);
    expect(functions.reach?.()).toBe('undefined,undefined,undefined,undefined');
  });

  it('stops a function that runs too long, and still works after', async () => {
    const functions = await sharedEngineFunctions(
      'export default { functions: { spin: () => { for (;;) {} }, one: () => 1 } };',
    );
    expect(() => functions.spin?.()).toThrow('interrupted');
    expect(functions.one?.()).toBe(1);
  });

  it('reports what a function throws', async () => {
    const functions = await sharedEngineFunctions(
      'export default { functions: { fail: () => { throw new Error("no luck"); } } };',
    );
    expect(() => functions.fail?.()).toThrow('no luck');
  });
});
