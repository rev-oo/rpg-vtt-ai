// The shapes of the dice: each die is a convex polyhedron, given by its vertices. Its faces come
// from a small convex hull, so the same face list feeds the physics body and the mesh.

export type Vec = readonly [number, number, number];

/** The dice this module draws. `d100` is thrown as two of the `d10` shape. */
export const SHAPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;
export type Shape = (typeof SHAPES)[number];

export interface Polyhedron {
  vertices: readonly Vec[];
  /** Vertex indices of each face, counter-clockwise seen from outside. */
  faces: readonly (readonly number[])[];
  /** Each face's outward unit normal. */
  normals: readonly Vec[];
}

const PHI = (1 + Math.sqrt(5)) / 2;
const EPSILON = 1e-6;

/** `list[index]`, which the caller knows is there. */
export function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`No item ${String(index)}`);
  return value;
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec): number => Math.sqrt(dot(a, a));
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];

function signs(values: readonly number[]): number[][] {
  const [first, ...rest] = values;
  if (first === undefined) return [[]];
  const tails = signs(rest);
  const heads = first === 0 ? [0] : [first, -first];
  return heads.flatMap((head) => tails.map((tail) => [head, ...tail]));
}

/** Every sign combination of each base point, without duplicates. */
function expand(bases: readonly Vec[]): Vec[] {
  return bases.flatMap((base) => signs(base) as unknown as Vec[]);
}

/**
 * A pentagonal trapezohedron (the d10): two apexes and two rings of five, offset by 36°. With
 * the apexes at ±1 and the rings at ±h, the kites are flat when h = (1 − cos 36°)/(1 + cos 36°);
 * stretching along the axis keeps them flat.
 */
function trapezohedron(stretch: number): Vec[] {
  const c = Math.cos(Math.PI / 5);
  const h = ((1 - c) / (1 + c)) * stretch;
  const ring = (offset: number, z: number): Vec[] =>
    Array.from({ length: 5 }, (_, i) => {
      const angle = (2 * Math.PI * i) / 5 + offset;
      return [Math.cos(angle), Math.sin(angle), z] as const;
    });
  return [[0, 0, stretch], [0, 0, -stretch], ...ring(0, h), ...ring(Math.PI / 5, -h)];
}

const POINTS: Readonly<Record<Shape, Vec[]>> = {
  d4: [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ],
  d6: expand([[1, 1, 1]]),
  d8: expand([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]),
  d10: trapezohedron(1.15),
  d12: expand([
    [1, 1, 1],
    [0, 1 / PHI, PHI],
    [1 / PHI, PHI, 0],
    [PHI, 0, 1 / PHI],
  ]),
  d20: expand([
    [0, 1, PHI],
    [1, PHI, 0],
    [PHI, 0, 1],
  ]),
};

/** How far each die's vertices reach, so dice of every shape look about the same size. */
const RADIUS: Readonly<Record<Shape, number>> = {
  d4: 1.2,
  d6: 0.95,
  d8: 1.05,
  d10: 1.05,
  d12: 1.05,
  d20: 1.05,
};

/** The faces of the convex hull of `vertices`, which must all be corners of it. */
export function hull(vertices: readonly Vec[]): Pick<Polyhedron, 'faces' | 'normals'> {
  const faces: number[][] = [];
  const normals: Vec[] = [];
  const seen = new Set<string>();
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = at(vertices, i);
        const raw = cross(sub(at(vertices, j), a), sub(at(vertices, k), a));
        const size = length(raw);
        if (size < EPSILON) continue;
        let normal = scale(raw, 1 / size);
        let offset = dot(normal, a);
        const sides = vertices.map((v) => dot(normal, v) - offset);
        if (sides.every((s) => s >= -EPSILON)) {
          normal = scale(normal, -1);
          offset = -offset;
        } else if (!sides.every((s) => s <= EPSILON)) {
          continue;
        }
        const on = vertices.flatMap((v, index) =>
          Math.abs(dot(normal, v) - offset) < EPSILON ? [index] : [],
        );
        const key = on.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        faces.push(wind(vertices, on, normal));
        normals.push(normal);
      }
    }
  }
  return { faces, normals };
}

/** Orders a face's vertices counter-clockwise around its outward normal. */
function wind(vertices: readonly Vec[], face: readonly number[], normal: Vec): number[] {
  const points = face.map((index) => at(vertices, index));
  const centre = scale(
    points.reduce<Vec>((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]),
    1 / points.length,
  );
  const u = sub(at(points, 0), centre);
  const w = cross(normal, u);
  const angle = (index: number): number => {
    const d = sub(at(vertices, index), centre);
    return Math.atan2(dot(w, d), dot(u, d));
  };
  return [...face].sort((x, y) => angle(x) - angle(y));
}

const cache = new Map<Shape, Polyhedron>();

/** A die's polyhedron, centred on the origin. */
export function polyhedron(shape: Shape): Polyhedron {
  const known = cache.get(shape);
  if (known) return known;
  const points = POINTS[shape];
  const reach = Math.max(...points.map(length));
  const vertices = points.map((p) => scale(p, RADIUS[shape] / reach));
  const made = { vertices, ...hull(vertices) };
  cache.set(shape, made);
  return made;
}

/** The centre of a face, as the average of its corners. */
export function faceCentre(solid: Polyhedron, face: number): Vec {
  const corners = at(solid.faces, face).map((index) => at(solid.vertices, index));
  return scale(
    corners.reduce<Vec>((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]),
    1 / corners.length,
  );
}

export { cross, dot, length, scale, sub };
