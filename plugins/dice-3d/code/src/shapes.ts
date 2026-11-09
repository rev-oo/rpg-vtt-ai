// The dice as convex polyhedra: vertices, and faces as lists of vertex indices wound
// counter-clockwise when seen from outside, so both three.js and cannon-es can use them.

export type Vec3 = readonly [number, number, number];

export type ShapeName = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';

export interface Shape {
  name: ShapeName;
  vertices: readonly Vec3[];
  faces: readonly (readonly number[])[];
  /** A d4 is read at the vertex pointing up; the others at the face pointing up. */
  readAt: 'face' | 'vertex';
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / length(a));

const at = (vertices: readonly Vec3[], index: number): Vec3 => {
  const vertex = vertices[index];
  if (!vertex) throw new Error(`no vertex ${String(index)}`);
  return vertex;
};

export function centroid(vertices: readonly Vec3[], face: readonly number[]): Vec3 {
  let sum: Vec3 = [0, 0, 0];
  for (const index of face) {
    const v = at(vertices, index);
    sum = [sum[0] + v[0], sum[1] + v[1], sum[2] + v[2]];
  }
  return scale(sum, 1 / face.length);
}

/** A face's outward unit normal (the shapes are centred on the origin). */
export function faceNormal(vertices: readonly Vec3[], face: readonly number[]): Vec3 {
  const [a, b, c] = face.map((index) => at(vertices, index));
  if (!a || !b || !c) throw new Error('a face needs three vertices');
  return normalize(cross(sub(b, a), sub(c, a)));
}

/** Winds every face counter-clockwise from outside. */
function outward(vertices: readonly Vec3[], faces: readonly (readonly number[])[]): number[][] {
  return faces.map((face) =>
    dot(faceNormal(vertices, face), centroid(vertices, face)) < 0 ? [...face].reverse() : [...face],
  );
}

/** Scales a shape so its farthest vertex is at `radius`. */
function fit(vertices: readonly Vec3[], radius: number): Vec3[] {
  const far = Math.max(...vertices.map(length));
  return vertices.map((v) => scale(v, radius / far));
}

/** Orders a face's vertices around its normal. */
function aroundNormal(vertices: readonly Vec3[], face: readonly number[], normal: Vec3): number[] {
  const middle = centroid(vertices, face);
  const first = at(vertices, face[0] ?? 0);
  const u = normalize(sub(first, middle));
  const v = cross(normal, u);
  const angle = (index: number) => {
    const d = sub(at(vertices, index), middle);
    return Math.atan2(dot(d, v), dot(d, u));
  };
  return [...face].sort((a, b) => angle(a) - angle(b));
}

const T = (1 + Math.sqrt(5)) / 2;

const ICOSAHEDRON: { vertices: Vec3[]; faces: number[][] } = {
  vertices: [
    [-1, T, 0],
    [1, T, 0],
    [-1, -T, 0],
    [1, -T, 0],
    [0, -1, T],
    [0, 1, T],
    [0, -1, -T],
    [0, 1, -T],
    [T, 0, -1],
    [T, 0, 1],
    [-T, 0, -1],
    [-T, 0, 1],
  ],
  faces: [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ],
};

/** The dodecahedron as the icosahedron's dual: a pentagon for each of its vertices. */
function dodecahedron(): { vertices: Vec3[]; faces: number[][] } {
  const { vertices, faces } = ICOSAHEDRON;
  const centres = faces.map((face) => centroid(vertices, face));
  const pentagons = vertices.map((vertex, index) => {
    const around = faces.flatMap((face, f) => (face.includes(index) ? [f] : []));
    return aroundNormal(centres, around, normalize(vertex));
  });
  return { vertices: centres, faces: pentagons };
}

/**
 * The pentagonal trapezohedron: two apexes and a zigzag ring. Its kites are flat when the
 * ring's height is `(1 - cos 36°) / (1 + cos 36°)` of the apex's.
 */
function trapezohedron(): { vertices: Vec3[]; faces: number[][] } {
  const c = Math.cos(Math.PI / 5);
  const ring = (1 - c) / (1 + c);
  const vertices: Vec3[] = [];
  for (let k = 0; k < 10; k += 1) {
    const angle = (k * Math.PI) / 5;
    vertices.push([Math.cos(angle), k % 2 === 0 ? ring : -ring, Math.sin(angle)]);
  }
  const top = vertices.push([0, 1, 0]) - 1;
  const bottom = vertices.push([0, -1, 0]) - 1;
  const faces: number[][] = [];
  for (let i = 0; i < 10; i += 2) {
    faces.push([top, i, i + 1, (i + 2) % 10]);
    faces.push([bottom, i + 1, (i + 2) % 10, (i + 3) % 10]);
  }
  // Taller than flat: a d10 looks and rolls like one when its apexes stand out.
  return { vertices: vertices.map(([x, y, z]) => [x, y * 1.15, z]), faces };
}

function shape(
  name: ShapeName,
  base: { vertices: readonly Vec3[]; faces: readonly (readonly number[])[] },
  radius: number,
  readAt: Shape['readAt'] = 'face',
): Shape {
  const vertices = fit(base.vertices, radius);
  return { name, vertices, faces: outward(vertices, base.faces), readAt };
}

export const SHAPES: Readonly<Record<ShapeName, Shape>> = {
  d4: shape(
    'd4',
    {
      vertices: [
        [1, 1, 1],
        [-1, -1, 1],
        [-1, 1, -1],
        [1, -1, -1],
      ],
      faces: [
        [2, 1, 0],
        [0, 3, 2],
        [1, 3, 0],
        [2, 3, 1],
      ],
    },
    1.2,
    'vertex',
  ),
  d6: shape(
    'd6',
    {
      vertices: [
        [-1, -1, -1],
        [1, -1, -1],
        [1, 1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
      faces: [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [2, 3, 7, 6],
        [1, 2, 6, 5],
        [0, 4, 7, 3],
      ],
    },
    1.05,
  ),
  d8: shape(
    'd8',
    {
      vertices: [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ],
      faces: [
        [0, 2, 4],
        [0, 4, 3],
        [0, 3, 5],
        [0, 5, 2],
        [1, 4, 2],
        [1, 3, 4],
        [1, 5, 3],
        [1, 2, 5],
      ],
    },
    1.15,
  ),
  d10: shape('d10', trapezohedron(), 1.1),
  d12: shape('d12', dodecahedron(), 1.15),
  d20: shape('d20', ICOSAHEDRON, 1.2),
};

/** How many values a shape shows: one per face, or one per vertex for a d4. */
export const sidesOf = (shape: Shape): number =>
  shape.readAt === 'vertex' ? shape.vertices.length : shape.faces.length;

/** The index of the face, or of the d4's vertex, pointing most nearly along `up`. */
export function readUp(shape: Shape, up: Vec3): number {
  const directions =
    shape.readAt === 'vertex'
      ? shape.vertices.map(normalize)
      : shape.faces.map((face) => faceNormal(shape.vertices, face));
  let best = 0;
  let bestDot = -Infinity;
  directions.forEach((direction, index) => {
    const d = dot(direction, up);
    if (d > bestDot) {
      bestDot = d;
      best = index;
    }
  });
  return best;
}
