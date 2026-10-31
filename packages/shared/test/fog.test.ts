import { describe, expect, it } from 'vitest';

import {
  hideArea,
  inFog,
  isRevealed,
  revealArea,
  subtractRect,
  type FogRect,
} from '../src/api/index.js';

const area = (x: number, y: number, width: number, height: number): FogRect => ({
  x,
  y,
  width,
  height,
});
const total = (rects: readonly FogRect[]) =>
  rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);

describe('fog of war (FR-MAP-04, ADR-070)', () => {
  it('cuts a rectangle out of another', () => {
    expect(subtractRect(area(0, 0, 2, 2), area(5, 5, 1, 1))).toEqual([area(0, 0, 2, 2)]);
    expect(subtractRect(area(0, 0, 2, 2), area(0, 0, 3, 3))).toEqual([]);
    const ring = subtractRect(area(0, 0, 3, 3), area(1, 1, 1, 1));
    expect(total(ring)).toBe(8);
    expect(ring.some((piece) => isRevealed([piece], 1.5, 1.5))).toBe(false);
  });

  it('reveals and hides areas, later changes winning', () => {
    let revealed = revealArea([], area(0, 0, 4, 4));
    revealed = revealArea(revealed, area(2, 2, 4, 4));
    expect(total(revealed)).toBe(28);
    revealed = hideArea(revealed, area(1, 1, 2, 2));
    expect(isRevealed(revealed, 0.5, 0.5)).toBe(true);
    expect(isRevealed(revealed, 1.5, 1.5)).toBe(false);
    expect(isRevealed(revealed, 5.5, 5.5)).toBe(true);
    expect(isRevealed(revealed, 6.5, 0.5)).toBe(false);
    // Revealing it again joins the pieces back into few rectangles.
    revealed = revealArea(revealed, area(1, 1, 2, 2));
    expect(total(revealed)).toBe(28);
  });

  it('keeps revealed areas apart, matching what was revealed and hidden', () => {
    // A small seeded generator, so a failure repeats.
    let seed = 7;
    const next = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % below;
    };
    for (let run = 0; run < 200; run++) {
      const cells = new Set<string>();
      let revealed: FogRect[] = [];
      for (let step = next(12); step > 0; step--) {
        const [x, y, width, height] = [next(10), next(10), next(6) + 1, next(6) + 1];
        const reveal = next(2) === 0;
        const rect = area(x, y, width, height);
        revealed = reveal ? revealArea(revealed, rect) : hideArea(revealed, rect);
        for (let column = x; column < x + width; column++) {
          for (let row = y; row < y + height; row++) {
            if (reveal) cells.add(`${String(column)},${String(row)}`);
            else cells.delete(`${String(column)},${String(row)}`);
          }
        }
      }
      expect(total(revealed)).toBe(cells.size);
      for (let column = 0; column < 16; column++) {
        for (let row = 0; row < 16; row++) {
          expect(isRevealed(revealed, column + 0.5, row + 0.5)).toBe(
            cells.has(`${String(column)},${String(row)}`),
          );
        }
      }
    }
  });

  it('puts a token in the fog by its centre, only while fog is on', () => {
    const revealed = [area(2, 2, 1, 1)];
    expect(inFog({ fog: true, revealed }, 2, 2)).toBe(false);
    expect(inFog({ fog: true, revealed }, 3, 2)).toBe(true);
    // A gridless token's centre is half a cell past its column and row.
    expect(inFog({ fog: true, revealed }, 1.6, 1.6)).toBe(false);
    expect(inFog({ fog: true, revealed }, 1.4, 1.6)).toBe(true);
    expect(inFog({ fog: false, revealed }, 9, 9)).toBe(false);
  });
});
