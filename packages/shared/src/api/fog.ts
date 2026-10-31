import type { FogRect } from './scenes.js';

// Fog of war as a list of revealed rectangles that do not overlap (FR-MAP-04, ADR-070).
// The server keeps it and decides which tokens players see; the map draws the rest as fog.

/** Hundredths of a cell, so repeated cuts leave no slivers. */
const round = (value: number) => Math.round(value * 100) / 100;

function rect(x: number, y: number, right: number, bottom: number): FogRect | null {
  const [left, top] = [round(x), round(y)];
  const [width, height] = [round(right) - left, round(bottom) - top];
  return width > 0 && height > 0 ? { x: left, y: top, width, height } : null;
}

/** What of `area` lies outside `cut`: up to four rectangles. */
export function subtractRect(area: FogRect, cut: FogRect): FogRect[] {
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const cutRight = cut.x + cut.width;
  const cutBottom = cut.y + cut.height;
  if (cut.x >= right || cutRight <= area.x || cut.y >= bottom || cutBottom <= area.y) {
    return [area];
  }
  const top = Math.max(area.y, cut.y);
  const low = Math.min(bottom, cutBottom);
  return [
    rect(area.x, area.y, right, cut.y),
    rect(area.x, cutBottom, right, bottom),
    rect(area.x, top, cut.x, low),
    rect(cutRight, top, right, low),
  ].filter((piece) => piece !== null);
}

/** Joins rectangles that share a whole edge, so the list stays short. */
function merge(rects: readonly FogRect[]): FogRect[] {
  const joined = [...rects];
  for (let i = 0; i < joined.length; i++) {
    for (let j = i + 1; j < joined.length; j++) {
      const a = joined[i];
      const b = joined[j];
      if (!a || !b) continue;
      const side =
        a.y === b.y && a.height === b.height
          ? round(a.x + a.width) === b.x || round(b.x + b.width) === a.x
          : false;
      const below =
        a.x === b.x && a.width === b.width
          ? round(a.y + a.height) === b.y || round(b.y + b.height) === a.y
          : false;
      if (!side && !below) continue;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      joined[i] = {
        x,
        y,
        width: round(Math.max(a.x + a.width, b.x + b.width) - x),
        height: round(Math.max(a.y + a.height, b.y + b.height) - y),
      };
      joined.splice(j, 1);
      // The bigger rectangle may now join one already passed.
      j = i;
    }
  }
  return joined;
}

/** The revealed areas with `area` revealed too. */
export function revealArea(revealed: readonly FogRect[], area: FogRect): FogRect[] {
  const added = revealed.reduce<FogRect[]>(
    (pieces, shown) => pieces.flatMap((piece) => subtractRect(piece, shown)),
    [area],
  );
  return merge([...revealed, ...added]);
}

/** The revealed areas with `area` hidden again. */
export function hideArea(revealed: readonly FogRect[], area: FogRect): FogRect[] {
  return merge(revealed.flatMap((shown) => subtractRect(shown, area)));
}

/** Whether a point, in cells, is in a revealed area. */
export const isRevealed = (revealed: readonly FogRect[], x: number, y: number): boolean =>
  revealed.some(
    (area) => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height,
  );

/** Whether a token at this column and row stands in the fog of a scene. */
export const inFog = (
  scene: { fog: boolean; revealed: readonly FogRect[] },
  column: number,
  row: number,
): boolean => scene.fog && !isRevealed(scene.revealed, column + 0.5, row + 0.5);
