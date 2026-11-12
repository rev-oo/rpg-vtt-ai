import type { Viewport } from 'pixi-viewport';
import { Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';

import type { TokenView } from '@vtt/shared/api';

import { cellAt, cellCentre, type Cell, type Point, type SceneGrid } from './geometry.js';
import { loadImage } from './image.js';
import type { MapColors } from './map-style.js';
import type { Size } from './view.js';

export interface TokenHandlers {
  select: (token: TokenView) => void;
  /** A double click or tap: opens the token's actor. */
  open: (token: TokenView) => void;
  /** Dropped on another cell. */
  move: (token: TokenView, cell: Cell) => void;
  /** A right click: the token's menu, at a point of the canvas (ADR-069). */
  menu: (token: TokenView, at: Point) => void;
}

const COLORS = [0xb45309, 0x15803d, 0x1d4ed8, 0x7e22ce, 0xbe123c, 0x0f766e];
const SELECTED = 0xfacc15;
const DOUBLE_TAP_MS = 350;
/** Statuses drawn on a token; more show as a count (T-1618). */
const MAX_STATUS_ICONS = 5;

/** A colour that stays with a token across redraws. */
function colorOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] ?? 0;
}

/**
 * The tokens of a scene on the map (FR-MAP-03, ADR-068): a disc in the token's colour with
 * its image, if any, and its name. Tokens the member may move are dragged and dropped on a
 * cell; the viewport stops panning while one is held.
 */
export class TokenLayer {
  private readonly container = new Container();
  private readonly textures = new Map<string, Promise<Texture | null>>();
  private lastTap = { id: '', at: 0 };
  private radius = 0;
  private destroyed = false;

  constructor(private readonly viewport: Viewport) {
    viewport.addChild(this.container);
  }

  draw(
    tokens: readonly TokenView[],
    grid: SceneGrid,
    /** Where tokens may stand on a gridless scene: the grid and the background. */
    area: Size,
    selectedId: string | null,
    handlers: TokenHandlers,
    colors: MapColors,
  ): void {
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    const radius = grid.gridSize * 0.42;
    this.radius = radius;
    for (const token of tokens) {
      const piece = new Container();
      piece.position = cellCentre(grid, token);
      piece.alpha = token.hidden ? 0.5 : 1;
      piece.addChild(
        new Graphics()
          .circle(0, 0, radius)
          .fill(colorOf(token.id))
          .stroke({
            width: token.id === selectedId ? 4 : 2,
            color: token.id === selectedId ? SELECTED : 0xffffff,
          }),
      );
      if (token.imageUrl) this.addImage(piece, token.imageUrl, radius);
      else {
        const initial = new Text({
          text: token.name.slice(0, 1).toUpperCase(),
          style: { fill: 0xffffff, fontSize: radius, fontWeight: 'bold' },
        });
        initial.anchor.set(0.5);
        piece.addChild(initial);
      }
      piece.addChild(this.nameLabel(token.name, grid, radius, colors));
      this.addStatuses(piece, token, radius, colors);
      this.listen(piece, token, grid, area, handlers);
      this.container.addChild(piece);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const texture of this.textures.values()) {
      void texture.then((loaded) => loaded?.destroy(true));
    }
  }

  private texture(url: string): Promise<Texture | null> {
    let texture = this.textures.get(url);
    if (!texture) {
      texture = loadImage(url).then(
        ({ source }) => Texture.from(source),
        () => null,
      );
      this.textures.set(url, texture);
    }
    return texture;
  }

  /**
   * The token's name under the disc, on a pill in the theme's colours so it reads on any
   * background (T-1620); it hides while too small to read.
   */
  private nameLabel(name: string, grid: SceneGrid, radius: number, colors: MapColors): Container {
    const fontSize = Math.max(10, grid.gridSize * 0.18);
    const label = new Container();
    const text = new Text({ text: name, style: { fill: colors.fg, fontSize } });
    text.anchor.set(0.5, 0);
    const padX = fontSize * 0.4;
    const padY = fontSize * 0.15;
    const pill = new Graphics()
      .roundRect(
        -text.width / 2 - padX,
        -padY,
        text.width + padX * 2,
        text.height + padY * 2,
        (text.height + padY * 2) / 2,
      )
      .fill({ color: colors.surface, alpha: 0.9 });
    label.addChild(pill, text);
    label.y = radius + 2 + padY;
    return label;
  }

  /**
   * The statuses that are on (T-1618): the system's icons in a row along the top of the disc,
   * the last replaced by a count when there are too many. Each icon has a ring in the theme's
   * foreground colour, which keeps a dark icon visible on a dark map (T-1620). Names and
   * statuses keep their size on the map at every zoom.
   */
  private addStatuses(piece: Container, token: TokenView, radius: number, colors: MapColors): void {
    const { statuses } = token;
    if (statuses.length === 0) return;
    const size = radius * 0.55;
    const shown = statuses.length > MAX_STATUS_ICONS ? MAX_STATUS_ICONS - 1 : statuses.length;
    const slots = Math.min(statuses.length, MAX_STATUS_ICONS);
    const x = (slot: number) => (slot - (slots - 1) / 2) * size;
    const row = new Container();
    row.y = -radius + size * 0.2;
    piece.addChild(row);
    statuses.slice(0, shown).forEach((status, slot) => {
      row.addChild(
        new Graphics()
          .circle(x(slot), 0, size / 2)
          .stroke({ width: Math.max(1, size * 0.08), color: colors.fg, alpha: 0.9 }),
      );
      void this.texture(status.icon).then((loaded) => {
        if (!loaded || piece.destroyed || this.destroyed) return;
        const sprite = new Sprite(loaded);
        sprite.scale.set(size / Math.max(loaded.width, loaded.height));
        sprite.anchor.set(0.5);
        sprite.position.set(x(slot), 0);
        row.addChildAt(sprite, 0);
        this.viewport.dirty = true;
      });
    });
    if (shown < statuses.length) {
      const more = new Text({
        text: `+${String(statuses.length - shown)}`,
        style: {
          fill: colors.fg,
          fontSize: size * 0.6,
          fontWeight: 'bold',
          stroke: { color: colors.surface, width: 3 },
        },
      });
      more.anchor.set(0.5);
      more.position.set(x(shown), 0);
      row.addChild(more);
    }
  }

  private addImage(piece: Container, url: string, radius: number): void {
    void this.texture(url).then((loaded) => {
      if (!loaded || piece.destroyed || this.destroyed) return;
      const sprite = new Sprite(loaded);
      const scale = (radius * 2) / Math.min(loaded.width, loaded.height);
      sprite.scale.set(scale);
      sprite.anchor.set(0.5);
      const mask = new Graphics().circle(0, 0, radius - 2).fill(0xffffff);
      sprite.mask = mask;
      piece.addChildAt(mask, 1);
      piece.addChildAt(sprite, 2);
      this.viewport.dirty = true;
    });
  }

  /** Tokens take no pointer while another tool, such as the ruler, has the map. */
  setInteractive(on: boolean): void {
    this.container.eventMode = on ? 'passive' : 'none';
  }

  /** Whether a scene point is on a token. */
  covers({ x, y }: { x: number; y: number }): boolean {
    return this.container.children.some(
      (piece) => (piece.x - x) ** 2 + (piece.y - y) ** 2 <= this.radius ** 2,
    );
  }

  private listen(
    piece: Container,
    token: TokenView,
    grid: SceneGrid,
    area: Size,
    handlers: TokenHandlers,
  ) {
    piece.eventMode = 'static';
    piece.cursor = token.movable ? 'grab' : 'pointer';
    /** Set when a drag moved the token: the tap that ends it is no first half of a double tap. */
    let dragged = false;
    piece.on('rightclick', (event) => {
      event.stopPropagation();
      handlers.menu(token, { x: event.global.x, y: event.global.y });
    });
    piece.on('pointertap', (event) => {
      if (event.button !== 0) return;
      if (dragged) {
        dragged = false;
        handlers.select(token);
        return;
      }
      const now = performance.now();
      if (this.lastTap.id === token.id && now - this.lastTap.at < DOUBLE_TAP_MS) {
        handlers.open(token);
      }
      this.lastTap = { id: token.id, at: now };
      handlers.select(token);
    });
    if (!token.movable) return;

    const start = { x: piece.x, y: piece.y };
    let held = false;
    const follow = (event: FederatedPointerEvent) => {
      if (!held) return;
      dragged = true;
      piece.position = this.viewport.toWorld(event.global);
      this.viewport.dirty = true;
    };
    const drop = () => {
      if (!held) return;
      held = false;
      this.viewport.plugins.resume('drag');
      piece.cursor = 'grab';
      const cell = cellAt(grid, piece.position, area);
      if (!cell || (cell.column === token.column && cell.row === token.row)) {
        piece.position = start;
        this.viewport.dirty = true;
        return;
      }
      piece.position = cellCentre(grid, cell);
      this.viewport.dirty = true;
      handlers.move(token, cell);
    };
    piece.on('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      held = true;
      piece.cursor = 'grabbing';
      this.viewport.plugins.pause('drag');
    });
    piece.on('globalpointermove', follow);
    piece.on('pointerup', drop);
    piece.on('pointerupoutside', drop);
  }
}
