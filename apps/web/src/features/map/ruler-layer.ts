import type { Viewport } from 'pixi-viewport';
import { Container, Graphics, Text } from 'pixi.js';

import type { Point } from './geometry.js';

const COLOR = 0xf59e0b;

/**
 * The ruler on the map (FR-MAP-05, ADR-069): a line between two scene points with a dot at
 * each end and the distance by the far one. Line and label keep their size on screen at any
 * zoom. Only the member measuring sees it.
 */
export class RulerLayer {
  private readonly container = new Container();
  private readonly line = new Graphics();
  private readonly label = new Text({
    text: '',
    style: {
      fontSize: 14,
      fontWeight: '600',
      fill: 0xffffff,
      stroke: { color: 0x111827, width: 4 },
    },
  });
  private shown: { from: Point; to: Point; text: string } | null = null;

  constructor(private readonly viewport: Viewport) {
    this.container.eventMode = 'none';
    this.container.addChild(this.line, this.label);
    viewport.addChild(this.container);
    viewport.on('zoomed', this.redraw);
  }

  draw(from: Point, to: Point, text: string): void {
    this.shown = { from, to, text };
    this.redraw();
  }

  clear(): void {
    this.shown = null;
    this.redraw();
  }

  destroy(): void {
    this.viewport.off('zoomed', this.redraw);
  }

  private readonly redraw = (): void => {
    this.line.clear();
    this.label.visible = this.shown !== null;
    this.viewport.dirty = true;
    if (!this.shown) return;
    const { from, to, text } = this.shown;
    const scale = 1 / this.viewport.scale.x;
    this.line
      .moveTo(from.x, from.y)
      .lineTo(to.x, to.y)
      .stroke({ width: 3 * scale, color: COLOR })
      .circle(from.x, from.y, 5 * scale)
      .circle(to.x, to.y, 5 * scale)
      .fill(COLOR);
    this.label.text = text;
    this.label.scale.set(scale);
    this.label.position.set(to.x + 10 * scale, to.y - 24 * scale);
  };
}
