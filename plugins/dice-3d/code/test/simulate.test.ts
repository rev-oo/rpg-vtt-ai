import { describe, expect, it } from 'vitest';

import { MAX_STEPS, simulate } from '../src/simulate.js';
import { SIDES } from '../src/shapes.js';

const bounds = { halfWidth: 20, halfDepth: 12 };

describe('throws', () => {
  it('the same seed throws the same way', () => {
    const a = simulate([20, 6, 4], 'message-1', bounds);
    const b = simulate([20, 6, 4], 'message-1', bounds);
    expect(a).toEqual(b);
    expect(simulate([20, 6, 4], 'message-2', bounds).frames).not.toEqual(a.frames);
  });

  it.each(Array.from({ length: 24 }, (_, i) => `seed-${String(i)}`))(
    'every die settles on the floor, inside the walls (%s)',
    (seed) => {
      const run = simulate(SIDES, seed, bounds);
      expect(run.settled).toBe(true);
      expect(run.frames.length).toBeLessThanOrEqual(MAX_STEPS + 1);
      const last = run.frames.at(-1) ?? [];
      for (const { position } of last) {
        expect(position[1]).toBeGreaterThan(0);
        expect(position[1]).toBeLessThan(1.2);
        expect(Math.abs(position[0])).toBeLessThan(bounds.halfWidth);
        expect(Math.abs(position[2])).toBeLessThan(bounds.halfDepth);
      }
    },
  );
});
