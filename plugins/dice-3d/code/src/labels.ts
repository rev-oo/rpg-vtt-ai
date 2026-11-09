import type { Die } from './dice.js';
import { polyhedron } from './polyhedra.js';

/**
 * The text on each face of a die (each corner for a d4) once it has landed with `top` up:
 * the dice's usual order, with the result swapped onto the top. The physics never knows the
 * numbers, so any face may carry the server's result.
 */
export function labelsFor(die: Die, top: number): string[] {
  const solid = polyhedron(die.shape);
  const slots = die.shape === 'd4' ? solid.vertices.length : solid.faces.length;
  const labels = Array.from({ length: slots }, (_, index) => die.labels[index] ?? '');
  const from = labels.indexOf(die.top);
  if (from < 0 || top < 0 || top >= slots) return labels;
  [labels[from], labels[top]] = [labels[top] ?? '', die.top];
  return labels;
}

/** The text a landed die shows on top: what the e2e suite and the tests compare with. */
export function shownOnTop(labels: readonly string[], top: number): string {
  return labels[top] ?? '';
}
