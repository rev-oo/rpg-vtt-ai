// Which value each face (or, on a d4, each corner) of a die shows, and how to change that so the
// die shows the server's result after the physics decided which face lands up.

import { at, dot, type Shape, type Vec3 } from './shapes.js';

/** Values in the order of the shape's faces, or of its vertices on a d4. */
export type Labels = number[];

/** A die's labels before any change: opposite faces add up to sides + 1 (to 9 on a d10). */
export function initialLabels(shape: Shape): Labels {
  if (shape.reads === 'vertex') return shape.vertices.map((_, i) => i + 1);
  const labels: Labels = shape.faces.map(() => -1);
  const sum = shape.sides === 10 ? 9 : shape.sides + 1;
  let next = shape.sides === 10 ? 0 : 1;
  shape.faces.forEach((face, i) => {
    if (labels[i] !== -1) return;
    if (face.opposite === null) throw new Error('Face without an opposite');
    labels[i] = next;
    labels[face.opposite] = sum - next;
    next += 1;
  });
  return labels;
}

/** Rotates a vector by a unit quaternion (x, y, z, w). */
export function rotate(v: Vec3, q: readonly [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 · (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

const UP: Vec3 = [0, 1, 0];

/** The index of the face (or d4 vertex) pointing most nearly up for a die turned by `q`. */
export function upIndex(shape: Shape, q: readonly [number, number, number, number]): number {
  const directions =
    shape.reads === 'vertex' ? shape.vertices : shape.faces.map((face) => face.normal);
  let best = 0;
  let bestDot = -Infinity;
  directions.forEach((direction, i) => {
    const d = dot(rotate(direction, q), UP);
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  });
  return best;
}

/**
 * Changes the labels so the face (or vertex) at `up` shows `value`, by swapping two labels and,
 * where faces have opposites, the two labels opposite them, so opposite faces still add up.
 */
export function relabel(shape: Shape, labels: Labels, up: number, value: number): Labels {
  const out = [...labels];
  const from = out.indexOf(value);
  if (from === -1) throw new RangeError(`A d${String(shape.sides)} has no face ${String(value)}`);
  if (from === up) return out;
  const current = at(out, up);
  out[up] = value;
  out[from] = current;
  if (shape.reads === 'face') {
    const upOpposite = at(shape.faces, up).opposite;
    const fromOpposite = at(shape.faces, from).opposite;
    if (upOpposite !== null && fromOpposite !== null && upOpposite !== from) {
      const a = at(out, upOpposite);
      out[upOpposite] = at(out, fromOpposite);
      out[fromOpposite] = a;
    }
  }
  return out;
}
