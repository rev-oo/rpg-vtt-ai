import { useEffect, useState } from 'react';

/**
 * The map's colours, from the app's theme tokens (T-1620): lines and text in the foreground
 * colour, pills behind names in the surface colour. They follow the light and dark schemes and
 * any module theme that sets the tokens (ADR-076).
 */
export interface MapColors {
  fg: number;
  surface: number;
}

const FALLBACK: MapColors = { fg: 0x1c1d21, surface: 0xffffff };

/** A CSS colour as Pixi takes it: `#rgb`, `#rrggbb` or `rgb(r, g, b)`; else `undefined`. */
export function cssColor(text: string): number | undefined {
  const value = text.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex;
    return Number.parseInt(full, 16);
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)));
    return ((r ?? 0) << 16) | ((g ?? 0) << 8) | (b ?? 0);
  }
  return undefined;
}

/** The map's colours as the element's styles have them now. */
export function readMapColors(element: Element): MapColors {
  const style = getComputedStyle(element);
  return {
    fg: cssColor(style.getPropertyValue('--color-fg')) ?? FALLBACK.fg,
    surface: cssColor(style.getPropertyValue('--color-surface')) ?? FALLBACK.surface,
  };
}

/** The map's colours, read again when the colour scheme changes. */
export function useMapColors(): MapColors {
  const [colors, setColors] = useState(() => readMapColors(document.documentElement));
  useEffect(() => {
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      setColors(readMapColors(document.documentElement));
    };
    scheme.addEventListener('change', update);
    return () => {
      scheme.removeEventListener('change', update);
    };
  }, []);
  return colors;
}

/** The smallest name, in screen pixels, worth drawing; below it names hide. */
export const MIN_LABEL_PX = 9;
/** The smallest status icon, in screen pixels, worth drawing; below it statuses hide. */
export const MIN_STATUS_PX = 14;

/** Whether a name of `fontSize` world pixels can be read at `zoom`. */
export const labelReadable = (fontSize: number, zoom: number): boolean =>
  fontSize * zoom >= MIN_LABEL_PX;

/** Whether status icons of `size` world pixels can be made out at `zoom`, as names do. */
export const statusReadable = (size: number, zoom: number): boolean => size * zoom >= MIN_STATUS_PX;
