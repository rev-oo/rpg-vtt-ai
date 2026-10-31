import {
  hideArea,
  isRevealed,
  MAX_SCENE_CELLS,
  snapsToCells,
  type FogRect,
  type GridType,
} from '@vtt/shared/api';

import type { Size } from './view.js';

// A scene's grid in pixels of its background (FR-MAP-02, ADR-067). Square cells are
// `gridSize` wide; hexes are pointy-top, `gridSize` wide, and odd rows sit half a hex right.
// A `hidden` grid keeps square cells that are not drawn, so tokens still snap to them; on a
// gridless (`none`) scene the cells are only a unit, and tokens stand anywhere on it.

export interface SceneGrid {
  columns: number;
  rows: number;
  gridType: GridType;
  gridSize: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Cell {
  column: number;
  row: number;
}

/** A line from (x1, y1) to (x2, y2). */
export type Segment = readonly [x1: number, y1: number, x2: number, y2: number];

/** A pointy-top hex's corner-to-centre distance, for a hex `width` wide. */
const radiusOf = (width: number): number => width / Math.sqrt(3);

/** The grid's size in pixels. */
export function sceneSize({ columns, rows, gridType, gridSize }: SceneGrid): Size {
  if (gridType !== 'hex') return { width: columns * gridSize, height: rows * gridSize };
  const radius = radiusOf(gridSize);
  return {
    width: columns * gridSize + (rows > 1 ? gridSize / 2 : 0),
    height: (rows - 1) * 1.5 * radius + 2 * radius,
  };
}

export function cellCentre(grid: SceneGrid, { column, row }: Cell): Point {
  const size = grid.gridSize;
  if (grid.gridType !== 'hex') return { x: (column + 0.5) * size, y: (row + 0.5) * size };
  const radius = radiusOf(size);
  return {
    x: size / 2 + column * size + (row % 2 === 1 ? size / 2 : 0),
    y: radius + row * 1.5 * radius,
  };
}

/**
 * The cell under a point, or `null` outside the grid. On a gridless scene it is the point
 * itself, in hundredths of a cell, anywhere in `area` (the grid and the background, in
 * pixels), kept so that a token there stays inside it.
 */
export function cellAt(grid: SceneGrid, { x, y }: Point, area = sceneSize(grid)): Cell | null {
  if (grid.gridType === 'none') return freeAt(grid, x, y, area);
  const cell = cellUnder(grid, { x, y });
  const inside =
    cell.column >= 0 && cell.row >= 0 && cell.column < grid.columns && cell.row < grid.rows;
  return inside ? cell : null;
}

/** The square or hex under a point, on the grid or past its edge. */
export const cellUnder = (grid: SceneGrid, { x, y }: Point): Cell =>
  grid.gridType === 'hex' ? hexAt(grid, x, y) : squareAt(grid, x, y);

const toHundredths = (value: number) => Math.round(value * 100) / 100;
/** Between 0 and the last whole cell of `pixels`, and no further than tokens may stand. */
const within = (cells: number, pixels: number, gridSize: number) =>
  Math.max(0, Math.min(cells, pixels / gridSize - 1, MAX_SCENE_CELLS - 1));

function freeAt({ gridSize }: SceneGrid, x: number, y: number, area: Size): Cell | null {
  if (x < 0 || y < 0 || x > area.width || y > area.height) return null;
  return {
    column: toHundredths(within(x / gridSize - 0.5, area.width, gridSize)),
    row: toHundredths(within(y / gridSize - 0.5, area.height, gridSize)),
  };
}

const squareAt = ({ gridSize }: SceneGrid, x: number, y: number): Cell => ({
  column: Math.floor(x / gridSize),
  row: Math.floor(y / gridSize),
});

/** Pixel to axial coordinates, rounded in cube space, then to odd-row offsets. */
function hexAt({ gridSize }: SceneGrid, x: number, y: number): Cell {
  const radius = radiusOf(gridSize);
  const px = x - gridSize / 2;
  const py = y - radius;
  const q = ((Math.sqrt(3) / 3) * px - py / 3) / radius;
  const r = ((2 / 3) * py) / radius;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { column: rq + (rr - (rr & 1)) / 2, row: rr };
}

/** A pointy-top hex's corners, clockwise from the top. */
export function hexCorners(grid: SceneGrid, cell: Cell): Point[] {
  const { x, y } = cellCentre(grid, cell);
  const half = grid.gridSize / 2;
  const radius = radiusOf(grid.gridSize);
  return [
    { x, y: y - radius },
    { x: x + half, y: y - radius / 2 },
    { x: x + half, y: y + radius / 2 },
    { x, y: y + radius },
    { x: x - half, y: y + radius / 2 },
    { x: x - half, y: y - radius / 2 },
  ];
}

/**
 * The grid's lines, each drawn once: a square grid's rows and columns, or every hex edge,
 * shared edges included only once. A gridless scene has none.
 */
export function gridSegments(grid: SceneGrid): Segment[] {
  if (grid.gridType === 'hidden' || grid.gridType === 'none') return [];
  if (grid.gridType === 'square') {
    const { width, height } = sceneSize(grid);
    const segments: Segment[] = [];
    for (let column = 0; column <= grid.columns; column += 1) {
      const x = column * grid.gridSize;
      segments.push([x, 0, x, height]);
    }
    for (let row = 0; row <= grid.rows; row += 1) {
      const y = row * grid.gridSize;
      segments.push([0, y, width, y]);
    }
    return segments;
  }
  const seen = new Set<string>();
  const segments: Segment[] = [];
  const key = (a: Point, b: Point) => {
    const [first, second] = a.x < b.x || (a.x === b.x && a.y < b.y) ? [a, b] : [b, a];
    return [first.x, first.y, second.x, second.y].map((n) => n.toFixed(2)).join(',');
  };
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const corners = hexCorners(grid, { column, row });
      corners.forEach((a, index) => {
        const b = corners[(index + 1) % corners.length] ?? a;
        const edge = key(a, b);
        if (seen.has(edge)) return;
        seen.add(edge);
        segments.push([a.x, a.y, b.x, b.y]);
      });
    }
  }
  return segments;
}

const STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Where an arrow key moves a token: a cell over, kept on the scene. A gridless scene's tokens
 * may stand on its background beyond the cells (ADR-068), so only the cell limit holds them
 * there. `undefined` for any other key, `null` at an edge.
 */
export function stepCell(
  grid: SceneGrid,
  { column, row }: Cell,
  key: string,
): Cell | null | undefined {
  const by = STEPS[key];
  if (!by) return undefined;
  const free = !snapsToCells(grid.gridType);
  const next = { column: column + by[0], row: row + by[1] };
  const last = {
    column: free ? MAX_SCENE_CELLS - 1 : grid.columns - 1,
    row: free ? MAX_SCENE_CELLS - 1 : grid.rows - 1,
  };
  const inside =
    next.column >= 0 && next.row >= 0 && next.column <= last.column && next.row <= last.row;
  return inside ? next : null;
}

const hundredths = (value: number) => Math.round(value * 100) / 100;

/**
 * The area a drag from `from` to `to` reveals or hides (ADR-070), in cells. On a grid it is
 * every cell from the one the drag starts on to the one it ends on, so a click takes one
 * cell; on a hex grid, the columns and rows between them. A gridless scene takes the drag as
 * it is. `null` when the drag covers no cell.
 */
export function fogArea(grid: SceneGrid, from: Point, to: Point): FogRect | null {
  if (grid.gridType === 'none') {
    const limit = (value: number) =>
      Math.min(Math.max(0, hundredths(value / grid.gridSize)), MAX_SCENE_CELLS);
    const x = limit(Math.min(from.x, to.x));
    const y = limit(Math.min(from.y, to.y));
    const width = hundredths(limit(Math.max(from.x, to.x)) - x);
    const height = hundredths(limit(Math.max(from.y, to.y)) - y);
    return width > 0 && height > 0 ? { x, y, width, height } : null;
  }
  const start = cellUnder(grid, from);
  const end = cellUnder(grid, to);
  const span = (a: number, b: number, cells: number) => {
    const low = Math.max(0, Math.min(a, b));
    const high = Math.min(cells - 1, Math.max(a, b));
    return low <= high ? { low, size: high - low + 1 } : null;
  };
  const columns = span(start.column, end.column, grid.columns);
  const rows = span(start.row, end.row, grid.rows);
  if (!columns || !rows) return null;
  return { x: columns.low, y: rows.low, width: columns.size, height: rows.size };
}

/** What the fog covers, in scene pixels: rectangles, and on a hex grid hidden hexes. */
export interface FogShapes {
  rects: FogRect[];
  hexes: Point[][];
}

/**
 * The fog over `area` (the grid and the background) apart from the revealed areas. On a hex
 * grid a hex is revealed when its centre, in columns and rows, is; past the grid all is fog.
 */
export function fogShapes(grid: SceneGrid, revealed: readonly FogRect[], area: Size): FogShapes {
  const whole = { x: 0, y: 0, width: area.width, height: area.height };
  if (grid.gridType !== 'hex') {
    const size = grid.gridSize;
    const inCells = { x: 0, y: 0, width: area.width / size, height: area.height / size };
    const hidden = revealed.reduce((rest, shown) => hideArea(rest, shown), [inCells]);
    return {
      rects: hidden.map(({ x, y, width, height }) => ({
        x: x * size,
        y: y * size,
        width: width * size,
        height: height * size,
      })),
      hexes: [],
    };
  }
  const hexes: Point[][] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (!isRevealed(revealed, column + 0.5, row + 0.5)) {
        hexes.push(hexCorners(grid, { column, row }));
      }
    }
  }
  const { width, height } = sceneSize(grid);
  return { rects: hideArea([whole], { x: 0, y: 0, width, height }), hexes };
}

/** A fog area in scene pixels, around its cells' centres on a hex grid, to outline it. */
export function fogPixels(grid: SceneGrid, area: FogRect): FogRect {
  const size = grid.gridSize;
  if (grid.gridType !== 'hex') {
    return {
      x: area.x * size,
      y: area.y * size,
      width: area.width * size,
      height: area.height * size,
    };
  }
  // Odd rows sit half a hex right, so the corners take in a row of each kind.
  const lastRow = area.y + area.height - 1;
  const centres = [area.y, Math.min(area.y + 1, lastRow), Math.max(area.y, lastRow - 1), lastRow]
    .flatMap((row) => [area.x, area.x + area.width - 1].map((column) => ({ column, row })))
    .map((cell) => cellCentre(grid, cell));
  const xs = centres.map((centre) => centre.x);
  const ys = centres.map((centre) => centre.y);
  const radius = radiusOf(size);
  const left = Math.min(...xs) - size / 2;
  const top = Math.min(...ys) - radius;
  return {
    x: left,
    y: top,
    width: Math.max(...xs) + size / 2 - left,
    height: Math.max(...ys) + radius - top,
  };
}
