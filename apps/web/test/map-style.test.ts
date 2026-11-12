import { describe, expect, it } from 'vitest';

import {
  cssColor,
  labelReadable,
  MIN_STATUS_PX,
  readMapColors,
  statusScale,
} from '../src/features/map/map-style.js';

describe('map style (T-1620)', () => {
  it('reads theme colours as Pixi takes them', () => {
    expect(cssColor('#1c1d21')).toBe(0x1c1d21);
    expect(cssColor(' #fff ')).toBe(0xffffff);
    expect(cssColor('rgb(236, 236, 241)')).toBe(0xececf1);
    expect(cssColor('rgba(20 21 24 / 50%)')).toBe(0x141518);
    expect(cssColor('oklch(0.5 0.1 200)')).toBeUndefined();
  });

  it("takes the grid and label colours from the theme's tokens", () => {
    const element = document.createElement('div');
    element.style.setProperty('--color-fg', '#ececf1');
    element.style.setProperty('--color-surface', '#1e2025');
    document.body.append(element);
    expect(readMapColors(element)).toEqual({ fg: 0xececf1, surface: 0x1e2025 });
    element.remove();
  });

  it('hides names too small to read at the zoom', () => {
    // A 12 px name reads at full size and at 0.75, not at 0.5.
    expect(labelReadable(12, 1)).toBe(true);
    expect(labelReadable(12, 0.75)).toBe(true);
    expect(labelReadable(12, 0.5)).toBe(false);
  });

  it('keeps status icons at their minimum size on screen', () => {
    // 22 px icons are big enough at full zoom; zoomed out to a quarter, they grow back.
    expect(statusScale(22, 1)).toBe(1);
    expect(statusScale(22, 2)).toBe(1);
    expect(22 * 0.25 * statusScale(22, 0.25)).toBeCloseTo(MIN_STATUS_PX);
  });
});
