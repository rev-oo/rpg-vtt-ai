import { describe, expect, it } from 'vitest';

import { diceFor, MAX_DICE, relabel, throwFor, type RolledMessage } from '../src/dice.js';
import { randomFrom, simulate } from '../src/physics.js';
import {
  centroid,
  faceNormal,
  readUp,
  SHAPES,
  sidesOf,
  type ShapeName,
  type Vec3,
} from '../src/shapes.js';

const NAMES = Object.keys(SHAPES) as ShapeName[];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('shapes', () => {
  it.each([
    ['d4', 4],
    ['d6', 6],
    ['d8', 8],
    ['d10', 10],
    ['d12', 12],
    ['d20', 20],
  ] as const)('a %s has %i values', (name, sides) => {
    expect(sidesOf(SHAPES[name])).toBe(sides);
  });

  it.each(NAMES)('every %s face is flat and faces outwards', (name) => {
    const { vertices, faces } = SHAPES[name];
    for (const face of faces) {
      const normal = faceNormal(vertices, face);
      const middle = centroid(vertices, face);
      expect(dot(normal, middle)).toBeGreaterThan(0);
      for (const index of face) {
        const vertex = vertices[index] ?? [0, 0, 0];
        const off: Vec3 = [vertex[0] - middle[0], vertex[1] - middle[1], vertex[2] - middle[2]];
        expect(Math.abs(dot(off, normal))).toBeLessThan(1e-9);
      }
    }
  });

  it('reads the face, or the d4 vertex, pointing up', () => {
    const d6 = SHAPES.d6;
    const up = readUp(d6, [0, 1, 0]);
    expect(faceNormal(d6.vertices, d6.faces[up] ?? [])[1]).toBeCloseTo(1);
    const d4 = SHAPES.d4;
    expect(readUp(d4, [1, 1, 1])).toBe(0);
  });
});

describe('dice for a roll', () => {
  it('throws one die per result, on the face for its value', () => {
    expect(diceFor('d20', 14, true)).toEqual([
      expect.objectContaining({ shape: 'd20', result: 13, active: true }),
    ]);
    // A d10 shows 0 for 10.
    const [d10] = diceFor('d10', 10, true) ?? [];
    expect(d10?.labels[d10.result]).toBe('0');
  });

  it('throws a d100 as tens and units', () => {
    const shown = (value: number) =>
      (diceFor('d100', value, true) ?? []).map((die) => die.labels[die.result]);
    expect(shown(47)).toEqual(['40', '7']);
    expect(shown(5)).toEqual(['00', '5']);
    expect(shown(100)).toEqual(['00', '0']);
  });

  it('skips dice it has no shape for', () => {
    expect(diceFor('d7', 3, true)).toBeNull();
    expect(diceFor('dF', 1, true)).toBeNull();
    expect(diceFor('d6', 7, true)).toBeNull();
  });

  it('collects every die of a message, up to the limit', () => {
    const message: RolledMessage = {
      id: 'm1',
      senderId: 'u1',
      rolls: [
        {
          dice: [
            {
              die: 'd6',
              results: [
                { value: 2, active: true },
                { value: 5, active: false },
              ],
            },
            { die: 'dF', results: [{ value: 1, active: true }] },
          ],
        },
        { dice: [{ die: 'd100', results: [{ value: 42, active: true }] }] },
      ],
    };
    expect(throwFor(message)).toMatchObject({
      results: ['d6:2', 'd6:5', 'd100:42'],
      skipped: 1,
    });
    const many: RolledMessage = {
      id: 'm2',
      senderId: null,
      rolls: [
        {
          dice: [
            { die: 'd6', results: Array.from({ length: 40 }, () => ({ value: 1, active: true })) },
          ],
        },
      ],
    };
    expect(throwFor(many)).toMatchObject({ skipped: 40 - MAX_DICE });
    // The same message throws the same way for every viewer.
    expect(throwFor(many).seed).toBe(throwFor({ ...many, rolls: [] }).seed);
    expect(throwFor(many).seed).not.toBe(throwFor(message).seed);
  });

  it('relabels a die so the result is on the face that landed up', () => {
    expect(relabel(['1', '2', '3', '4'], 0, 2)).toEqual(['3', '2', '1', '4']);
    expect(relabel(['1', '2'], 1, 1)).toEqual(['1', '2']);
  });
});

describe('physics', () => {
  it('throws dice that come to rest on the table, each with a face up', () => {
    const dice = [...NAMES, 'd20' as const];
    const { frames, up } = simulate(dice, { halfWidth: 14, halfDepth: 9 }, randomFrom(7));
    expect(frames.length).toBeGreaterThan(20);
    const last = frames.at(-1) ?? new Float32Array();
    dice.forEach((name, index) => {
      const [x = 0, y = 0, z = 0] = last.subarray(index * 7, index * 7 + 3);
      expect(Math.abs(x)).toBeLessThan(14);
      expect(Math.abs(z)).toBeLessThan(9);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(2);
      expect(up[index]).toBeLessThan(sidesOf(SHAPES[name]));
    });
  });

  it('repeats a throw from the same seed', () => {
    const table = { halfWidth: 10, halfDepth: 8 };
    expect(simulate(['d6', 'd8'], table, randomFrom(3)).up).toEqual(
      simulate(['d6', 'd8'], table, randomFrom(3)).up,
    );
  });
});
