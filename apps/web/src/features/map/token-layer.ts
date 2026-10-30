import type { Viewport } from 'pixi-viewport';
import { Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';

import type { TokenView } from '@vtt/shared/api';

import { cellAt, cellCentre, type Cell, type SceneGrid } from './geometry.js';
import { loadImage } from './image.js';
import type { Size } from './view.js';

export interface TokenHandlers {
  select: (token: TokenView) => void;
  /** A double click or tap: opens the token's actor. */
  open: (token: TokenView) => void;
  /** Dropped on another cell. */
  move: (token: TokenView, cell: Cell) => void;
}

const COLORS = [0xb45309, 0x15803d, 0x1d4ed8, 0x7e22ce, 0xbe123c, 0x0f766e];
const SELECTED = 0xfacc15;
const DOUBLE_TAP_MS = 350;

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
  ): void {
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    const radius = grid.gridSize * 0.42;
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
      const label = new Text({
        text: token.name,
        style: {
          fill: 0xffffff,
          fontSize: Math.max(10, grid.gridSize * 0.18),
          stroke: { color: 0x111827, width: 3 },
        },
      });
      label.anchor.set(0.5, 0);
      label.y = radius + 2;
      piece.addChild(label);
      this.listen(piece, token, grid, area, handlers);
      this.container.addChild(piece);
    }
    this.viewport.dirty = true;
  }

  destroy(): void {
    this.destroyed = true;
    for (const texture of this.textures.values()) {
      void texture.then((loaded) => loaded?.destroy(true));
    }
  }

  private addImage(piece: Container, url: string, radius: number): void {
    let texture = this.textures.get(url);
    if (!texture) {
      texture = loadImage(url).then(
        ({ source }) => Texture.from(source),
        () => null,
      );
      this.textures.set(url, texture);
    }
    void texture.then((loaded) => {
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

  private listen(
    piece: Container,
    token: TokenView,
    grid: SceneGrid,
    area: Size,
    handlers: TokenHandlers,
  ) {
    piece.eventMode = 'static';
    piece.cursor = token.movable ? 'grab' : 'pointer';
    piece.on('pointertap', () => {
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
