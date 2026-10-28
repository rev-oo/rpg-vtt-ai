import { useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';

import { PANEL_MAX, PANEL_MIN } from './layout-store.js';

/** Arrow keys move the handle this far; with Shift, four times as far. */
const STEP = 16;

const clamp = (value: number): number => Math.min(PANEL_MAX, Math.max(PANEL_MIN, value));

export interface ResizerProps {
  /** The width of the panel it resizes, in pixels. */
  width: number;
  onResize: (width: number) => void;
  label: string;
  /** The id of the panel it resizes. */
  controls: string;
  /** Which side of the handle the panel is on: moving away from it widens it. */
  side: 'left' | 'right';
}

/** A drag handle between a panel and the stage, usable with the keyboard (NFR-10). */
export function Resizer({ width, onResize, label, controls, side }: ResizerProps): ReactElement {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const sign = side === 'left' ? 1 : -1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start) onResize(clamp(start.width + sign * (e.clientX - start.x)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const moves: Record<string, number> = {
      ArrowLeft: width - sign * step,
      ArrowRight: width + sign * step,
      Home: PANEL_MIN,
      End: PANEL_MAX,
    };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onResize(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      tabIndex={0}
      className="hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-line hover:bg-primary focus-visible:bg-primary focus-visible:outline-none md:block"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
