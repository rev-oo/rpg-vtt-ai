import type { DiagonalRule } from '@vtt/shared/api';

import { cellUnder, type Cell, type Point, type SceneGrid } from './geometry.js';

// The ruler (FR-MAP-05, ADR-069): how long a path through points of a scene is, in cells and
// in the scene's own unit. Squares count steps by the scene's diagonal rule, hexes count hexes,
// and a gridless scene measures the straight line, a cell being its scale.

export interface SceneScale extends SceneGrid {
  /** What one cell measures, in the scene's unit. */
  cellDistance: number;
  diagonals: DiagonalRule;
}

export interface Measure {
  /** Cells along the path, to a tenth on a gridless scene or for straight diagonals. */
  cells: number;
  /** `cells` in the scene's unit, to a tenth. */
  distance: number;
}

const toTenths = (value: number) => Math.round(value * 10) / 10;

/**
 * The length of a path through `points`, taken as one move: with alternating diagonals, every
 * second diagonal of the whole path costs two cells, not every second one of each leg.
 */
export function measure(scene: SceneScale, points: readonly Point[]): Measure {
  let straight = 0;
  let diagonals = 0;
  let free = 0;
  for (let leg = 1; leg < points.length; leg += 1) {
    const from = points[leg - 1];
    const to = points[leg];
    if (!from || !to) continue;
    if (scene.gridType === 'none') {
      free += Math.hypot(to.x - from.x, to.y - from.y) / scene.gridSize;
      continue;
    }
    const a = cellUnder(scene, from);
    const b = cellUnder(scene, to);
    if (scene.gridType === 'hex') {
      straight += hexDistance(a, b);
      continue;
    }
    const across = Math.abs(b.column - a.column);
    const down = Math.abs(b.row - a.row);
    if (scene.diagonals === 'straight') {
      free += Math.hypot(across, down);
      continue;
    }
    straight += Math.max(across, down) - Math.min(across, down);
    diagonals += Math.min(across, down);
  }
  // Every second diagonal costs two cells under the alternating rule.
  const extra = scene.diagonals === 'alternate' ? Math.floor(diagonals / 2) : 0;
  const cells = toTenths(straight + diagonals + extra + free);
  return { cells, distance: toTenths(cells * scene.cellDistance) };
}

/** Hexes between two odd-row offset cells, through cube coordinates. */
function hexDistance(a: Cell, b: Cell): number {
  const q = (cell: Cell) => cell.column - (cell.row - (cell.row & 1)) / 2;
  const dq = q(b) - q(a);
  const dr = b.row - a.row;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
