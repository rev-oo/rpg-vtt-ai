// The polyhedral dice as plain geometry, shared by the physics (cannon-es) and the renderer
// (three.js): vertices, faces as polygons wound counter-clockwise seen from outside, and which
// face each face is opposite to.

export type Vec3 = readonly [number, number, number];

export type Sides = 4 | 6 | 8 | 10 | 12 | 20;
export const SIDES: readonly Sides[] = [4, 6, 8, 10, 12, 20];

export interface Face {
  /** Indices into the shape's vertices, counter-clockwise seen from outside. */
  vertices: number[];
  /** Outward unit normal. */
  normal: Vec3;
  centre: Vec3;
  /** The face whose normal points the other way, if any (none on a d4). */
  opposite: number | null;
}

export interface Shape {
  sides: Sides;
  vertices: Vec3[];
  faces: Face[];
  /**
   * What is read when the die lands: the face pointing up, or on a d4 the vertex pointing up
   * (a d4 rests on a face, so its value is printed at the corners).
   */
  reads: 'face' | 'vertex';
}

const PHI = (1 + Math.sqrt(5)) / 2;
const EPSILON = 1e-6;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / length(a));

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`No element at ${String(index)}`);
  return value;
}
export { at };

/** Every sign combination of a point, without repeats. */
function signs(point: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const sx of [1, -1])
    for (const sy of [1, -1])
      for (const sz of [1, -1]) {
        const p: Vec3 = [point[0] * sx, point[1] * sy, point[2] * sz];
        if (!out.some((q) => length(sub(p, q)) < EPSILON)) out.push(p);
      }
  return out;
}

/** The three cyclic permutations of each point. */
const cyclic = (points: Vec3[]): Vec3[] =>
  points.flatMap((p) => [p, [p[1], p[2], p[0]] as Vec3, [p[2], p[0], p[1]] as Vec3]);

const ICOSAHEDRON = cyclic(signs([0, 1, PHI]));
const DODECAHEDRON = [...signs([1, 1, 1]), ...cyclic(signs([0, PHI, 1 / PHI]))];
const CUBE = signs([1, 1, 1]);
const OCTAHEDRON = cyclic(signs([1, 0, 0]));
const TETRAHEDRON: Vec3[] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
];

/** Orders a face's vertices counter-clockwise around its outward normal. */
function wind(vertices: readonly Vec3[], indices: number[], normal: Vec3): number[] {
  const centre = scale(
    indices.reduce<Vec3>((sum, i) => add(sum, at(vertices, i)), [0, 0, 0]),
    1 / indices.length,
  );
  const u = normalize(sub(at(vertices, at(indices, 0)), centre));
  const v = cross(normal, u);
  const angle = (i: number) => {
    const d = sub(at(vertices, i), centre);
    return Math.atan2(dot(d, v), dot(d, u));
  };
  return [...indices].sort((a, b) => angle(a) - angle(b));
}

/** Builds the faces of a convex solid from its vertices and the directions of its faces. */
function solid(sides: Sides, raw: Vec3[], directions: Vec3[], reads: Shape['reads']): Shape {
  const radius = Math.max(...raw.map(length));
  const vertices = raw.map((p) => scale(p, 1 / radius));
  const faces: Face[] = directions.map((direction) => {
    const normal = normalize(direction);
    const top = Math.max(...vertices.map((p) => dot(p, normal)));
    const members = vertices.flatMap((p, i) => (Math.abs(dot(p, normal) - top) < 1e-4 ? [i] : []));
    const order = wind(vertices, members, normal);
    const centre = scale(
      order.reduce<Vec3>((sum, i) => add(sum, at(vertices, i)), [0, 0, 0]),
      1 / order.length,
    );
    return { vertices: order, normal, centre, opposite: null };
  });
  for (const face of faces) {
    const index = faces.findIndex((other) => dot(other.normal, face.normal) < -1 + EPSILON);
    face.opposite = index === -1 ? null : index;
  }
  return { sides, vertices, faces, reads };
}

/**
 * A d10: a pentagonal trapezohedron. Ten ring vertices alternate above and below the equator
 * by `e`; the apexes at ±h make each kite flat when h = e (1 + cos 36°) / (1 − cos 36°).
 */
function trapezohedron(): Shape {
  const e = 0.105;
  const c = Math.cos(Math.PI / 5);
  const h = (e * (1 + c)) / (1 - c);
  const ring: Vec3[] = Array.from({ length: 10 }, (_, k) => [
    Math.cos((k * Math.PI) / 5),
    k % 2 === 0 ? e : -e,
    Math.sin((k * Math.PI) / 5),
  ]);
  const raw: Vec3[] = [[0, h, 0], [0, -h, 0], ...ring];
  // Kites: the top apex with ring 2i, 2i+1, 2i+2; the bottom apex with 2i+1, 2i+2, 2i+3.
  const ringIndex = (k: number) => 2 + (k % 10);
  const kites = [
    ...Array.from({ length: 5 }, (_, i) => [
      0,
      ringIndex(2 * i),
      ringIndex(2 * i + 1),
      ringIndex(2 * i + 2),
    ]),
    ...Array.from({ length: 5 }, (_, i) => [
      1,
      ringIndex(2 * i + 1),
      ringIndex(2 * i + 2),
      ringIndex(2 * i + 3),
    ]),
  ];
  const radius = Math.max(...raw.map(length));
  const vertices = raw.map((p) => scale(p, 1 / radius));
  const faces: Face[] = kites.map((kite) => {
    const points = kite.map((i) => at(vertices, i));
    const centre = scale(
      points.reduce<Vec3>((sum, p) => add(sum, p), [0, 0, 0]),
      1 / points.length,
    );
    let normal = normalize(
      cross(sub(at(points, 1), at(points, 0)), sub(at(points, 3), at(points, 0))),
    );
    if (dot(normal, centre) < 0) normal = scale(normal, -1);
    return { vertices: wind(vertices, kite, normal), normal, centre, opposite: null };
  });
  for (const face of faces) {
    const index = faces.findIndex((other) => dot(other.normal, face.normal) < -1 + 1e-4);
    face.opposite = index === -1 ? null : index;
  }
  return { sides: 10, vertices, faces, reads: 'face' };
}

const SHAPES = new Map<Sides, Shape>();

/** The shape of a die, built once. */
export function shapeOf(sides: Sides): Shape {
  let shape = SHAPES.get(sides);
  if (shape) return shape;
  switch (sides) {
    case 4:
      shape = solid(
        4,
        TETRAHEDRON,
        TETRAHEDRON.map((p) => scale(p, -1)),
        'vertex',
      );
      break;
    case 6:
      shape = solid(6, CUBE, OCTAHEDRON, 'face');
      break;
    case 8:
      shape = solid(8, OCTAHEDRON, CUBE, 'face');
      break;
    case 10:
      shape = trapezohedron();
      break;
    case 12:
      shape = solid(12, DODECAHEDRON, ICOSAHEDRON, 'face');
      break;
    case 20:
      shape = solid(20, ICOSAHEDRON, DODECAHEDRON, 'face');
      break;
  }
  SHAPES.set(sides, shape);
  return shape;
}
