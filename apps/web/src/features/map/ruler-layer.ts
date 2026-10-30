import type { Viewport } from 'pixi-viewport';
import { Container, Graphics, Text } from 'pixi.js';

import type { Point } from './geometry.js';

const COLOR = 0xf59e0b;

/** What the ruler shows: a path, a circle by its centre and radius, or a cone's outline. */
export type RulerShape =
  | { kind: 'path'; points: readonly Point[] }
  | { kind: 'circle'; centre: Point; radius: number }
  | { kind: 'cone'; outline: readonly Point[]; tip: Point };

/**
 * The ruler on the map (FR-MAP-05, ADR-069): a path through scene points with a dot at each,
 * a circle or a cone, with the distance beside it. Line and label keep their size on screen at any
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
  private shown: { shape: RulerShape; text: string } | null = null;

  constructor(private readonly viewport: Viewport) {
    this.container.eventMode = 'none';
    this.container.addChild(this.line, this.label);
    viewport.addChild(this.container);
    viewport.on('zoomed', this.redraw);
  }

  draw(shape: RulerShape, text: string): void {
    this.shown = { shape, text };
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
    const { shape, text } = this.shown;
    const scale = 1 / this.viewport.scale.x;
    const stroke = { width: 3 * scale, color: COLOR };
    let labelAt: Point;
    if (shape.kind === 'path') {
      const [first] = shape.points;
      const last = shape.points.at(-1);
      if (!first || !last) return;
      this.line.moveTo(first.x, first.y);
      for (const point of shape.points.slice(1)) this.line.lineTo(point.x, point.y);
      this.line.stroke(stroke);
      for (const point of shape.points) this.line.circle(point.x, point.y, 5 * scale);
      this.line.fill(COLOR);
      labelAt = last;
    } else if (shape.kind === 'circle') {
      const { centre, radius } = shape;
      this.line
        .circle(centre.x, centre.y, radius)
        .fill({ color: COLOR, alpha: 0.2 })
        .stroke(stroke);
      this.line.circle(centre.x, centre.y, 5 * scale).fill(COLOR);
      labelAt = { x: centre.x + radius, y: centre.y };
    } else {
      this.line.poly(shape.outline.flatMap((point) => [point.x, point.y]));
      this.line.fill({ color: COLOR, alpha: 0.2 }).stroke(stroke);
      labelAt = shape.tip;
    }
    this.label.text = text;
    this.label.scale.set(scale);
    this.label.position.set(labelAt.x + 10 * scale, labelAt.y - 24 * scale);
  };
}
