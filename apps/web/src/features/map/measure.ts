import type { DiagonalRule } from '@vtt/shared/api';

import { cellUnder, type Cell, type Point, type SceneGrid } from './geometry.js';

// The ruler (FR-MAP-05, ADR-069): how far apart two points of a scene are, in cells and in
// the scene's own unit. Squares count steps by the scene's diagonal rule, hexes count hexes,
// and a gridless scene measures the straight line, a cell being its scale.

export interface SceneScale extends SceneGrid {
  /** What one cell measures, in the scene's unit. */
  cellDistance: number;
  diagonals: DiagonalRule;
}

export interface Measure {
  /** Cells between the two ends, to a tenth on a gridless scene or for straight diagonals. */
  cells: number;
  /** `cells` in the scene's unit, to a tenth. */
  distance: number;
}

const toTenths = (value: number) => Math.round(value * 10) / 10;

export function measure(scene: SceneScale, from: Point, to: Point): Measure {
  const cells = toTenths(cellsBetween(scene, from, to));
  return { cells, distance: toTenths(cells * scene.cellDistance) };
}

function cellsBetween(scene: SceneScale, from: Point, to: Point): number {
  if (scene.gridType === 'none') {
    return Math.hypot(to.x - from.x, to.y - from.y) / scene.gridSize;
  }
  const a = cellUnder(scene, from);
  const b = cellUnder(scene, to);
  if (scene.gridType === 'hex') return hexDistance(a, b);
  const across = Math.abs(b.column - a.column);
  const down = Math.abs(b.row - a.row);
  const long = Math.max(across, down);
  const short = Math.min(across, down);
  switch (scene.diagonals) {
    case 'one':
      return long;
    case 'alternate':
      // Every second diagonal costs two cells.
      return long + Math.floor(short / 2);
    case 'straight':
      return Math.hypot(across, down);
  }
}

/** Hexes between two odd-row offset cells, through cube coordinates. */
function hexDistance(a: Cell, b: Cell): number {
  const q = (cell: Cell) => cell.column - (cell.row - (cell.row & 1)) / 2;
  const dq = q(b) - q(a);
  const dr = b.row - a.row;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
