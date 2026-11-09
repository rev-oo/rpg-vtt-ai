import { describe, expect, it } from 'vitest';

import { initialLabels, relabel, rotate, upIndex } from '../src/labels.js';
import { at, SIDES, shapeOf } from '../src/shapes.js';
import { random } from '../src/simulate.js';

const valuesOf = (sides: number) =>
  sides === 10 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : Array.from({ length: sides }, (_, i) => i + 1);

/** A random unit quaternion. */
function turn(next: () => number): [number, number, number, number] {
  const q = [next() - 0.5, next() - 0.5, next() - 0.5, next() - 0.5];
  const n = Math.hypot(...q);
  return [at(q, 0) / n, at(q, 1) / n, at(q, 2) / n, at(q, 3) / n];
}

describe('labels', () => {
  it.each(SIDES)('a d%i starts with each value once, opposite faces adding up', (sides) => {
    const shape = shapeOf(sides);
    const labels = initialLabels(shape);
    expect([...labels].sort((a, b) => a - b)).toEqual(valuesOf(sides));
    const sum = sides === 10 ? 9 : sides + 1;
    if (shape.reads === 'face')
      shape.faces.forEach((face, i) => {
        expect(at(labels, i) + at(labels, face.opposite ?? -1)).toBe(sum);
      });
  });

  it.each(SIDES)('a d%i relabelled for any value shows it on top, keeping its faces', (sides) => {
    const shape = shapeOf(sides);
    const next = random(`d${String(sides)}`);
    for (let n = 0; n < 50; n += 1) {
      const quaternion = turn(next);
      const up = upIndex(shape, quaternion);
      for (const value of valuesOf(sides)) {
        const labels = relabel(shape, initialLabels(shape), up, value);
        expect(at(labels, upIndex(shape, quaternion))).toBe(value);
        expect([...labels].sort((a, b) => a - b)).toEqual(valuesOf(sides));
        const sum = sides === 10 ? 9 : sides + 1;
        if (shape.reads === 'face')
          shape.faces.forEach((face, i) => {
            expect(at(labels, i) + at(labels, face.opposite ?? -1)).toBe(sum);
          });
      }
    }
  });

  it('rotates vectors by quaternions', () => {
    const half = Math.SQRT1_2;
    // 90° about z turns x into y.
    const [x, y, z] = rotate([1, 0, 0], [0, 0, half, half]);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
  });
});
