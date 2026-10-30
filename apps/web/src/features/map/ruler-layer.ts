import type { Viewport } from 'pixi-viewport';
import { Container, Graphics, Text } from 'pixi.js';

import type { Point } from './geometry.js';

const COLOR = 0xf59e0b;

/**
 * The ruler on the map (FR-MAP-05, ADR-069): a path through scene points with a dot at each
 * and the distance by the last. Line and label keep their size on screen at any
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
  private shown: { points: readonly Point[]; text: string } | null = null;

  constructor(private readonly viewport: Viewport) {
    this.container.eventMode = 'none';
    this.container.addChild(this.line, this.label);
    viewport.addChild(this.container);
    viewport.on('zoomed', this.redraw);
  }

  draw(points: readonly Point[], text: string): void {
    this.shown = { points, text };
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
    const { points, text } = this.shown;
    const [first] = points;
    const last = points.at(-1);
    if (!first || !last) return;
    const scale = 1 / this.viewport.scale.x;
    this.line.moveTo(first.x, first.y);
    for (const point of points.slice(1)) this.line.lineTo(point.x, point.y);
    this.line.stroke({ width: 3 * scale, color: COLOR });
    for (const point of points) this.line.circle(point.x, point.y, 5 * scale);
    this.line.fill(COLOR);
    this.label.text = text;
    this.label.scale.set(scale);
    this.label.position.set(last.x + 10 * scale, last.y - 24 * scale);
  };
}
