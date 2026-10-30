// Pixi compiles its shaders without `new Function` once this runs; the page's CSP has no
// 'unsafe-eval' (ADR-067).
import 'pixi.js/unsafe-eval';

import { Viewport } from 'pixi-viewport';
import { Application, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import type { SceneView, TokenView } from '@vtt/shared/api';
import { Button } from '@vtt/ui';

import { t } from '../../i18n/index.js';

import { gridSegments, sceneSize } from './geometry.js';
import { loadImage } from './image.js';
import { TokenLayer, type TokenHandlers } from './token-layer.js';
import { clampView, fitView, viewForKey, zoomBy, ZOOM_STEP, type Size, type View } from './view.js';

export interface MapCanvasProps extends TokenHandlers {
  scene: SceneView;
  tokens: readonly TokenView[];
  selectedId: string | null;
}

const GRID_COLOR = 0x1f2937;

/** How the last background load went. */
interface Loaded {
  url: string;
  shown: boolean;
}

interface Stage {
  app: Application;
  viewport: Viewport;
  background: Sprite;
  grid: Graphics;
  tokens: TokenLayer;
}

/**
 * A scene on a WebGL canvas (FR-MAP-02, ADR-067): its background and grid, panned and zoomed
 * by mouse, touch and keyboard. It draws only after something changed, to spare phones.
 */
export default function MapCanvas({
  scene,
  tokens,
  selectedId,
  ...handlers
}: MapCanvasProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const keysId = useId();
  /** The scene's size, for the resize observer, which outlives each scene. */
  const sizeRef = useRef<Size>({ width: 1, height: 1 });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const app = new Application();
    // The app's own ticker never starts, so Pixi renders only when this one finds a change.
    const ticker = new Ticker();
    let ready = false;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let tokenLayer: TokenLayer | null = null;
    app
      .init({
        width: Math.max(1, element.clientWidth),
        height: Math.max(1, element.clientHeight),
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 2),
        backgroundAlpha: 0,
        preference: 'webgl',
        autoStart: false,
      })
      .then(
        () => {
          ready = true;
          if (disposed) {
            app.destroy(true, { children: true });
            return;
          }
          app.canvas.setAttribute('aria-hidden', 'true');
          app.canvas.classList.add('absolute', 'inset-0', 'touch-none');
          element.prepend(app.canvas);

          const viewport = new Viewport({
            screenWidth: app.screen.width,
            screenHeight: app.screen.height,
            events: app.renderer.events,
            ticker,
          });
          const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          viewport.drag().pinch().wheel();
          if (!calm) viewport.decelerate();
          const backgroundLayer = viewport.addChild(new Sprite());
          const grid = viewport.addChild(new Graphics());
          tokenLayer = new TokenLayer(viewport);
          app.stage.addChild(viewport);

          ticker.add(() => {
            if (!viewport.dirty) return;
            viewport.dirty = false;
            app.render();
            show(element, viewport);
          });
          ticker.start();

          observer = new ResizeObserver(() => {
            const width = Math.max(1, element.clientWidth);
            const height = Math.max(1, element.clientHeight);
            // A panel behind another tab has no size; fit the scene when it first gets one.
            const unseen = viewport.screenWidth <= 1 || viewport.screenHeight <= 1;
            app.renderer.resize(width, height);
            viewport.resize(width, height);
            if (unseen) apply(viewport, fitView(sizeRef.current, { width, height }));
            viewport.dirty = true;
          });
          observer.observe(element);
          setStage({ app, viewport, background: backgroundLayer, grid, tokens: tokenLayer });
        },
        () => {
          ready = true;
          setFailed(true);
        },
      );
    return () => {
      disposed = true;
      observer?.disconnect();
      tokenLayer?.destroy();
      // The viewport leaves the ticker as the app destroys it, so the ticker goes last.
      if (ready) app.destroy(true, { children: true });
      ticker.destroy();
      setStage(null);
    };
  }, []);

  const { columns, rows, gridType, gridSize } = scene;
  const size = useMemo(
    () => sceneSize({ columns, rows, gridType, gridSize }),
    [columns, rows, gridType, gridSize],
  );

  // The grid, and the whole scene in view whenever another scene or size comes along.
  useEffect(() => {
    if (!stage) return;
    const { grid, viewport } = stage;
    sizeRef.current = size;
    grid.clear();
    for (const [x1, y1, x2, y2] of gridSegments({ columns, rows, gridType, gridSize })) {
      grid.moveTo(x1, y1).lineTo(x2, y2);
    }
    grid.stroke({ width: 1, color: GRID_COLOR, alpha: 0.45, pixelLine: true });
    viewport.resize(viewport.screenWidth, viewport.screenHeight, size.width, size.height);
    apply(viewport, fitView(size, screenOf(viewport)));

    // Pinches, wheels and drags stay inside the limits `view.ts` sets.
    const keep = () => {
      const now = viewOf(viewport);
      const kept = clampView(now, size, screenOf(viewport));
      if (kept.x !== now.x || kept.y !== now.y || kept.zoom !== now.zoom) apply(viewport, kept);
    };
    viewport.on('moved', keep);
    return () => {
      viewport.off('moved', keep);
    };
  }, [stage, scene.id, columns, rows, gridType, gridSize, size]);

  // The background under the grid, at its own size: cells are sized in its pixels (ADR-066).
  const url = scene.backgroundUrl;
  useEffect(() => {
    if (!stage) return;
    const layer = stage.background;
    if (url === null) return;
    let current = true;
    let texture: Texture | null = null;
    loadImage(url).then(
      ({ source, width, height }) => {
        if (!current) return;
        texture = Texture.from(source);
        layer.texture = texture;
        layer.width = width;
        layer.height = height;
        stage.viewport.dirty = true;
        setLoaded({ url, shown: true });
      },
      () => {
        if (current) setLoaded({ url, shown: false });
      },
    );
    return () => {
      current = false;
      // The whole stage may already be gone, when the canvas closes.
      if (!layer.destroyed) {
        layer.texture = Texture.EMPTY;
        stage.viewport.dirty = true;
      }
      texture?.destroy(true);
    };
  }, [stage, url]);

  // The tokens, redrawn whenever they or the selection change; handlers are always the latest.
  const select = useEffectEvent(handlers.select);
  const open = useEffectEvent(handlers.open);
  const move = useEffectEvent(handlers.move);
  useEffect(() => {
    stage?.tokens.draw(tokens, { columns, rows, gridType, gridSize }, selectedId, {
      select,
      open,
      move,
    });
  }, [stage, tokens, selectedId, columns, rows, gridType, gridSize]);

  const background =
    url === null ? 'none' : loaded?.url !== url ? 'loading' : loaded.shown ? 'shown' : 'blocked';

  const step = (next: (view: View) => View) => {
    if (!stage) return;
    const panel = screenOf(stage.viewport);
    apply(stage.viewport, clampView(next(viewOf(stage.viewport)), size, panel));
  };

  return (
    <div className="relative h-full overflow-hidden bg-canvas">
      <div
        ref={host}
        role="application"
        aria-roledescription={t('map.role')}
        aria-label={scene.name}
        aria-describedby={keysId}
        aria-busy={!stage && !failed}
        data-background={background}
        tabIndex={0}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2"
        onKeyDown={(event) => {
          if (!stage || event.altKey || event.ctrlKey || event.metaKey) return;
          const panel = screenOf(stage.viewport);
          const next = viewForKey(event.key, viewOf(stage.viewport), size, panel);
          if (!next) return;
          event.preventDefault();
          apply(stage.viewport, next);
        }}
      />
      <p id={keysId} className="sr-only">
        {t('map.keys')}
      </p>
      {failed && (
        <p role="alert" className="absolute inset-x-3 top-3 rounded-md bg-surface p-3 shadow">
          {t('map.unsupported')}
        </p>
      )}
      {background === 'blocked' && (
        <p role="status" className="absolute inset-x-3 top-3 rounded-md bg-surface p-3 shadow">
          {t('map.backgroundBlocked')}
        </p>
      )}
      <div className="absolute right-3 bottom-3 flex gap-1">
        <Button
          disabled={!stage}
          aria-label={t('map.zoomIn')}
          onClick={() => {
            step((view) => zoomBy(view, ZOOM_STEP));
          }}
        >
          +
        </Button>
        <Button
          disabled={!stage}
          aria-label={t('map.zoomOut')}
          onClick={() => {
            step((view) => zoomBy(view, 1 / ZOOM_STEP));
          }}
        >
          −
        </Button>
        <Button
          disabled={!stage}
          onClick={() => {
            step(() => fitView(size, screenOf(stage?.viewport)));
          }}
        >
          {t('map.fit')}
        </Button>
      </div>
    </div>
  );
}

const screenOf = (viewport: Viewport | undefined): Size => ({
  width: viewport?.screenWidth ?? 1,
  height: viewport?.screenHeight ?? 1,
});

const viewOf = (viewport: Viewport): View => ({
  x: viewport.center.x,
  y: viewport.center.y,
  zoom: viewport.scaled,
});

function apply(viewport: Viewport, view: View): void {
  viewport.setZoom(view.zoom, true);
  viewport.moveCenter(view.x, view.y);
  viewport.dirty = true;
}

/** The view, on the element, for tests and for anyone inspecting the page. */
function show(element: HTMLElement, viewport: Viewport): void {
  const view = viewOf(viewport);
  element.dataset.zoom = view.zoom.toFixed(3);
  element.dataset.x = view.x.toFixed(1);
  element.dataset.y = view.y.toFixed(1);
}
