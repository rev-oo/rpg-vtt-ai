import type { GridType } from '@vtt/shared/api';

// A scene's grid in pixels of its background (FR-MAP-02, ADR-067). Square cells are
// `gridSize` wide; hexes are pointy-top, `gridSize` wide, and odd rows sit half a hex right.

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
export function sceneSize({ columns, rows, gridType, gridSize }: SceneGrid): {
  width: number;
  height: number;
} {
  if (gridType === 'square') return { width: columns * gridSize, height: rows * gridSize };
  const radius = radiusOf(gridSize);
  return {
    width: columns * gridSize + (rows > 1 ? gridSize / 2 : 0),
    height: (rows - 1) * 1.5 * radius + 2 * radius,
  };
}

export function cellCentre(grid: SceneGrid, { column, row }: Cell): Point {
  const size = grid.gridSize;
  if (grid.gridType === 'square') return { x: (column + 0.5) * size, y: (row + 0.5) * size };
  const radius = radiusOf(size);
  return {
    x: size / 2 + column * size + (row % 2 === 1 ? size / 2 : 0),
    y: radius + row * 1.5 * radius,
  };
}

/** The cell under a point, or `null` outside the grid. */
export function cellAt(grid: SceneGrid, { x, y }: Point): Cell | null {
  const cell = grid.gridType === 'square' ? squareAt(grid, x, y) : hexAt(grid, x, y);
  const inside =
    cell.column >= 0 && cell.row >= 0 && cell.column < grid.columns && cell.row < grid.rows;
  return inside ? cell : null;
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
 * shared edges included only once.
 */
export function gridSegments(grid: SceneGrid): Segment[] {
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
