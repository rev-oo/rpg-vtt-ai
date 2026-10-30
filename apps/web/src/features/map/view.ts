// The map's camera (FR-MAP-02, ADR-067): which scene point sits at the middle of the panel,
// and how far it is zoomed. The canvas follows it, so this is what tests check.

export interface Size {
  width: number;
  height: number;
}

export interface View {
  /** The scene point at the middle of the panel. */
  x: number;
  y: number;
  /** Screen pixels per scene pixel. */
  zoom: number;
}

/** How far one key press or zoom button moves the view. */
export const PAN_STEP = 80;
export const ZOOM_STEP = 1.25;
const MAX_ZOOM = 4;

/** The zoom that shows the whole scene in the panel. */
export function fitZoom(scene: Size, panel: Size): number {
  if (scene.width <= 0 || scene.height <= 0) return 1;
  return Math.min(panel.width / scene.width, panel.height / scene.height);
}

/** From half the whole-scene zoom (or 1:1, if smaller) to 4×. */
export function zoomLimits(scene: Size, panel: Size): { min: number; max: number } {
  const fit = fitZoom(scene, panel);
  return { min: Math.min(fit, 1) / 2, max: Math.max(MAX_ZOOM, fit) };
}

/** The whole scene, centred. */
export function fitView(scene: Size, panel: Size): View {
  return { x: scene.width / 2, y: scene.height / 2, zoom: fitZoom(scene, panel) };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Keeps the zoom in its limits, and the scene from leaving the panel: it may be dragged until
 * its edge meets the panel's far edge, but no further, so it can always be brought back.
 */
export function clampView(view: View, scene: Size, panel: Size): View {
  const { min, max } = zoomLimits(scene, panel);
  const zoom = clamp(view.zoom, min, max);
  const slackX = panel.width / 2 / zoom;
  const slackY = panel.height / 2 / zoom;
  return {
    x: clamp(view.x, -slackX, scene.width + slackX),
    y: clamp(view.y, -slackY, scene.height + slackY),
    zoom,
  };
}

/** Moves the view by screen pixels. */
export const panBy = (view: View, dx: number, dy: number): View => ({
  ...view,
  x: view.x + dx / view.zoom,
  y: view.y + dy / view.zoom,
});

export const zoomBy = (view: View, factor: number): View => ({
  ...view,
  zoom: view.zoom * factor,
});

/** What a key does to the view, if anything: arrows pan, + and - zoom, 0 shows it all. */
export function viewForKey(key: string, view: View, scene: Size, panel: Size): View | null {
  const next = (() => {
    switch (key) {
      case 'ArrowLeft':
        return panBy(view, -PAN_STEP, 0);
      case 'ArrowRight':
        return panBy(view, PAN_STEP, 0);
      case 'ArrowUp':
        return panBy(view, 0, -PAN_STEP);
      case 'ArrowDown':
        return panBy(view, 0, PAN_STEP);
      case '+':
      case '=':
        return zoomBy(view, ZOOM_STEP);
      case '-':
      case '_':
        return zoomBy(view, 1 / ZOOM_STEP);
      case '0':
        return fitView(scene, panel);
      default:
        return null;
    }
  })();
  return next && clampView(next, scene, panel);
}
