import type { Viewport } from 'pixi-viewport';
import { Graphics } from 'pixi.js';

import type { FogRect } from '@vtt/shared/api';

import type { FogShapes } from './geometry.js';

const FOG = 0x0b0f19;
const MARK = 0x38bdf8;

/**
 * The fog of war on the map (FR-MAP-04, ADR-070), over the background and grid and under the
 * tokens. Players see it opaque; GMs and assistants as a tint, to keep preparing beneath it.
 * While a GM drags out an area, it is outlined.
 */
export class FogLayer {
  private readonly fog = new Graphics();
  private readonly mark = new Graphics();

  /** Made after the grid and before the tokens, so the fog lies between them. */
  constructor(private readonly viewport: Viewport) {
    this.fog.eventMode = 'none';
    this.mark.eventMode = 'none';
    viewport.addChild(this.fog);
  }

  draw(shapes: FogShapes | null, tint: boolean): void {
    this.fog.clear();
    if (shapes) {
      for (const { x, y, width, height } of shapes.rects) this.fog.rect(x, y, width, height);
      for (const hex of shapes.hexes) this.fog.poly(hex.flatMap((point) => [point.x, point.y]));
      this.fog.fill({ color: FOG, alpha: tint ? 0.5 : 1 });
    }
    this.viewport.dirty = true;
  }

  /** Outlines an area in scene pixels, or clears the outline. */
  outline(area: FogRect | null, hiding: boolean): void {
    this.mark.clear();
    // Above everything, tokens included.
    if (!this.mark.parent) this.viewport.addChild(this.mark);
    if (area) {
      const width = 2 / this.viewport.scale.x;
      this.mark
        .rect(area.x, area.y, area.width, area.height)
        .fill({ color: hiding ? FOG : MARK, alpha: 0.25 })
        .stroke({ width, color: MARK });
    }
    this.viewport.dirty = true;
  }

  destroy(): void {
    this.fog.destroy();
    this.mark.destroy();
  }
}
