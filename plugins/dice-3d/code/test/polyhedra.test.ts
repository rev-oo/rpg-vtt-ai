import { describe, expect, it } from 'vitest';

import { dot, faceCentre, polyhedron, SHAPES, type Shape } from '../src/polyhedra.js';

const FACES: Record<Shape, number> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

describe('polyhedron', () => {
  it.each(SHAPES)('gives %s its faces, each flat and facing out', (shape) => {
    const solid = polyhedron(shape);
    expect(solid.faces).toHaveLength(FACES[shape]);
    solid.faces.forEach((face, index) => {
      const normal = solid.normals[index] ?? [0, 0, 0];
      expect(dot(normal, faceCentre(solid, index))).toBeGreaterThan(0);
      const offsets = face.map((corner) => dot(normal, solid.vertices[corner] ?? [0, 0, 0]));
      for (const offset of offsets) expect(offset).toBeCloseTo(offsets[0] ?? 0, 6);
    });
  });

  it('makes the d10 of kites, every vertex on three or five faces', () => {
    const solid = polyhedron('d10');
    expect(solid.faces.every((face) => face.length === 4)).toBe(true);
    const uses = solid.vertices.map(
      (_, index) => solid.faces.filter((face) => face.includes(index)).length,
    );
    expect(uses.toSorted()).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5]);
  });

  it('winds each face counter-clockwise seen from outside', () => {
    for (const shape of SHAPES) {
      const solid = polyhedron(shape);
      solid.faces.forEach((face, index) => {
        const [a, b, c] = face.map((corner) => solid.vertices[corner] ?? [0, 0, 0]);
        if (!a || !b || !c) throw new Error('a face needs three corners');
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
        const turn = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ] as const;
        expect(dot(turn, solid.normals[index] ?? [0, 0, 0])).toBeGreaterThan(0);
      });
    }
  });
});
