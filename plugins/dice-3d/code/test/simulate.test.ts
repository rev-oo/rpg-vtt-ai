import { Quaternion } from 'cannon-es';
import { describe, expect, it } from 'vitest';

import { SHAPES } from '../src/polyhedra.js';
import { simulate, STRIDE, topOf } from '../src/simulate.js';

/** A small seeded generator (mulberry32), so throws repeat. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const arena = { halfWidth: 18, halfDepth: 10 };

describe('simulate', () => {
  it('lands every kind of die flat, inside the arena, within six seconds', () => {
    const result = simulate(SHAPES, arena, seeded(7));
    expect(result.settled).toBe(true);
    expect(result.steps).toBeLessThanOrEqual(360);
    expect(result.frames).toHaveLength(result.steps * SHAPES.length * STRIDE);
    const last = (result.steps - 1) * SHAPES.length * STRIDE;
    SHAPES.forEach((_, index) => {
      const at = last + index * STRIDE;
      expect(Math.abs(result.frames[at] ?? Infinity)).toBeLessThan(arena.halfWidth);
      expect(Math.abs(result.frames[at + 2] ?? Infinity)).toBeLessThan(arena.halfDepth);
      expect(result.frames[at + 1]).toBeGreaterThan(0);
    });
  });

  it('repeats a throw from the same seed', () => {
    const a = simulate(['d20', 'd6'], arena, seeded(3));
    const b = simulate(['d20', 'd6'], arena, seeded(3));
    expect(a.tops).toEqual(b.tops);
    expect(a.steps).toBe(b.steps);
  });

  it('reports the face on top from the final pose', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const result = simulate(['d8', 'd12'], arena, seeded(seed));
      const last = (result.steps - 1) * 2 * STRIDE;
      (['d8', 'd12'] as const).forEach((shape, index) => {
        const f = result.frames.subarray(last + index * STRIDE + 3, last + index * STRIDE + 7);
        const turn = new Quaternion(f[0], f[1], f[2], f[3]);
        expect(topOf(shape, turn).index).toBe(result.tops[index]);
      });
    }
  });
});
