import { describe, expect, it } from 'vitest';

import { at, cross, dot, length, SIDES, shapeOf, sub } from '../src/shapes.js';

describe('dice shapes', () => {
  it.each(SIDES)('a d%i has as many faces as sides, flat and wound outward', (sides) => {
    const shape = shapeOf(sides);
    expect(shape.faces).toHaveLength(sides);
    for (const face of shape.faces) {
      expect(length(face.normal)).toBeCloseTo(1);
      expect(dot(face.normal, face.centre)).toBeGreaterThan(0);
      const corners = face.vertices.map((i) => at(shape.vertices, i));
      // Every corner lies on the face's plane.
      for (const corner of corners)
        expect(dot(sub(corner, face.centre), face.normal)).toBeCloseTo(0, 5);
      // Counter-clockwise seen from outside: each turn agrees with the normal.
      corners.forEach((corner, k) => {
        const next = at(corners, (k + 1) % corners.length);
        const after = at(corners, (k + 2) % corners.length);
        expect(dot(cross(sub(next, corner), sub(after, next)), face.normal)).toBeGreaterThan(0);
      });
    }
    // Every edge is shared by exactly two faces: the solid is closed.
    const edges = new Map<string, number>();
    for (const face of shape.faces)
      face.vertices.forEach((v, k) => {
        const w = at(face.vertices, (k + 1) % face.vertices.length);
        const key = `${String(Math.min(v, w))}-${String(Math.max(v, w))}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      });
    for (const count of edges.values()) expect(count).toBe(2);
  });

  it.each(SIDES.filter((sides) => sides !== 4))('each face of a d%i has an opposite', (sides) => {
    const shape = shapeOf(sides);
    shape.faces.forEach((face, i) => {
      expect(face.opposite).not.toBeNull();
      expect(at(shape.faces, face.opposite ?? -1).opposite).toBe(i);
    });
  });

  it('a d4 is read by the corner pointing up', () => {
    expect(shapeOf(4).reads).toBe('vertex');
    expect(shapeOf(4).faces.every((face) => face.opposite === null)).toBe(true);
  });
});
