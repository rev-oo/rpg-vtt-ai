import type { Point } from './geometry.js';

/** A token menu's width in pixels (ADR-069). */
export const MENU_WIDTH = 208;

/** Keeps a menu opened near an edge inside the panel. */
export function menuPosition(
  at: Point,
  panel: { width: number; height: number },
  items: number,
): Point {
  const height = 8 + items * 34;
  return {
    x: Math.max(4, Math.min(at.x, panel.width - MENU_WIDTH - 4)),
    y: Math.max(4, Math.min(at.y, panel.height - height - 4)),
  };
}
