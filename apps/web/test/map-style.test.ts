import { describe, expect, it } from 'vitest';

import { cssColor, readMapColors } from '../src/features/map/map-style.js';

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
});
