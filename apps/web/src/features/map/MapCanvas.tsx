// Pixi compiles its shaders without `new Function` once this runs; the page's CSP has no
// 'unsafe-eval' (ADR-067).
import 'pixi.js/unsafe-eval';

import { Viewport } from 'pixi-viewport';
import {
  Application,
  Graphics,
  Sprite,
  Texture,
  Ticker,
  type FederatedPointerEvent,
} from 'pixi.js';
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
import { carriesActor, droppedActor } from '../entities/entity-drag.js';

import {
  cellAt,
  cellCentre,
  cellUnder,
  gridSegments,
  sceneSize,
  stepCell,
  type Cell,
  type Point,
  type SceneGrid,
} from './geometry.js';
import { loadImage } from './image.js';
import { measure, type Measure } from './measure.js';
import { menuPosition } from './menu-position.js';
import { RulerLayer } from './ruler-layer.js';
import { TokenLayer, type TokenHandlers } from './token-layer.js';
import { TokenMenu, type MenuAction } from './TokenMenu.js';
import {
  clampView,
  fitView,
  viewForKey,
  zoomBy,
  zoomLimits,
  ZOOM_STEP,
  type Size,
  type View,
} from './view.js';

export interface MapCanvasProps extends Omit<TokenHandlers, 'menu'> {
  scene: SceneView;
  tokens: readonly TokenView[];
  selectedId: string | null;
  /** A click on the map off every token: nothing is selected any more. */
  deselect: () => void;
  /** For GMs: an actor dragged from a list and dropped on a cell, to place its token. */
  onDropActor?: ((actorId: string, cell: Cell) => void) | undefined;
  /** What the member may do with a token, for its menu; none, and it has no menu. */
  actionsFor: (token: TokenView) => MenuAction[];
}

/** What a press on the map does: select and move tokens, or measure (ADR-069). */
type Tool = 'select' | 'ruler';

/** The ruler's path, for keys and double clicks; each answers whether it changed anything. */
interface RulerControl {
  end: () => boolean;
  undo: () => boolean;
  clear: () => boolean;
}

const GRID_COLOR = 0x1f2937;

/** How the last background load went. */
interface Loaded {
  url: string;
  shown: boolean;
  /** The image's own size, when shown. */
  width: number;
  height: number;
}

interface Stage {
  app: Application;
  viewport: Viewport;
  background: Sprite;
  grid: Graphics;
  tokens: TokenLayer;
  ruler: RulerLayer;
}

/**
 * A scene on a WebGL canvas (FR-MAP-02, ADR-067): its background and grid, panned and zoomed
 * by mouse, touch and keyboard. It draws only after something changed, to spare phones.
 */
export default function MapCanvas({
  scene,
  tokens,
  selectedId,
  deselect,
  onDropActor,
  actionsFor,
  ...handlers
}: MapCanvasProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const keysId = useId();
  const [tool, setTool] = useState<Tool>('select');
  const [measured, setMeasured] = useState<(Measure & { points: number }) | null>(null);
  const [menu, setMenu] = useState<{ token: TokenView; at: Point } | null>(null);
  /** What the view frames, for the resize observer, which outlives each scene. */
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
    let rulerLayer: RulerLayer | null = null;
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
          rulerLayer = new RulerLayer(viewport);
          app.stage.addChild(viewport);

          const draw = () => {
            viewport.dirty = false;
            app.render();
            show(element, viewport);
          };
          ticker.add(() => {
            if (viewport.dirty) draw();
          });
          ticker.start();

          observer = new ResizeObserver(() => {
            const width = Math.max(1, element.clientWidth);
            const height = Math.max(1, element.clientHeight);
            if (width === app.screen.width && height === app.screen.height) return;
            // A panel behind another tab has no size; fit the scene when it first gets one.
            const unseen = viewport.screenWidth <= 1 || viewport.screenHeight <= 1;
            app.renderer.resize(width, height);
            viewport.resize(width, height);
            limitZoom(viewport, sizeRef.current);
            if (unseen) apply(viewport, fitView(sizeRef.current, { width, height }));
            // Resizing clears the canvas; drawing at once, before the browser paints, keeps a
            // panel being resized from showing it blank between frames.
            draw();
          });
          observer.observe(element);
          setStage({
            app,
            viewport,
            background: backgroundLayer,
            grid,
            tokens: tokenLayer,
            ruler: rulerLayer,
          });
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
      rulerLayer?.destroy();
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

  const url = scene.backgroundUrl;

  // The grid's lines; a gridless scene has none.
  useEffect(() => {
    if (stage) drawGrid(stage, { columns, rows, gridType, gridSize });
  }, [stage, columns, rows, gridType, gridSize]);

  // The view frames the grid and the background, which may reach beyond it.
  const shownImage = url !== null && loaded?.url === url && loaded.shown ? loaded : null;
  const content = useMemo(
    () => ({
      width: Math.max(size.width, shownImage?.width ?? 0),
      height: Math.max(size.height, shownImage?.height ?? 0),
    }),
    [size, shownImage?.width, shownImage?.height],
  );

  // The whole scene in view whenever another scene or size comes along.
  useEffect(() => {
    if (!stage) return;
    const { viewport } = stage;
    sizeRef.current = content;
    viewport.resize(viewport.screenWidth, viewport.screenHeight, content.width, content.height);
    limitZoom(viewport, content);
    apply(viewport, fitView(content, screenOf(viewport)));

    // Pinches, wheels and drags stay inside the limits `view.ts` sets.
    const keep = () => {
      const now = viewOf(viewport);
      const kept = clampView(now, content, screenOf(viewport));
      if (kept.x !== now.x || kept.y !== now.y || kept.zoom !== now.zoom) apply(viewport, kept);
    };
    viewport.on('moved', keep);
    return () => {
      viewport.off('moved', keep);
    };
  }, [stage, scene.id, content]);

  // The background under the grid, at its own size: cells are sized in its pixels (ADR-066).
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
        setLoaded({ url, shown: true, width, height });
      },
      () => {
        if (current) setLoaded({ url, shown: false, width: 0, height: 0 });
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
  const openMenu = (token: TokenView, at: Point) => {
    const actions = actionsFor(token);
    handlers.select(token);
    if (actions.length === 0 || !stage) return;
    setMenu({ token, at: menuPosition(at, screenOf(stage.viewport), actions.length) });
  };
  const menuOf = useEffectEvent(openMenu);
  useEffect(() => {
    stage?.tokens.draw(tokens, { columns, rows, gridType, gridSize }, content, selectedId, {
      select,
      open,
      move,
      menu: menuOf,
    });
  }, [stage, tokens, selectedId, columns, rows, gridType, gridSize, content]);

  // The ruler measures a path (ADR-069). A click or press starts it, each click adds a point and
  // a drag adds the point it ends on; until it ends, a last leg follows the pointer. Enter or a
  // double click ends it, Backspace takes back the last point, Escape clears it. Points snap
  // to cell centres on a grid.
  const { cellDistance, diagonals, distanceUnit } = scene;
  const rulerRef = useRef<RulerControl | null>(null);
  useEffect(() => {
    if (!stage) return;
    const { viewport, ruler, tokens: layer } = stage;
    const measuring = tool === 'ruler';
    layer.setInteractive(!measuring);
    if (!measuring) {
      ruler.clear();
      return;
    }
    viewport.plugins.pause('drag');
    const scale = { columns, rows, gridType, gridSize, cellDistance, diagonals };
    const snap = (point: Point) =>
      gridType === 'none' ? point : cellCentre(scale, cellUnder(scale, point));
    let path: Point[] = [];
    let ended = false;
    let pointer: Point | null = null;
    let pressed: { x: number; y: number; started: boolean } | null = null;

    const show = () => {
      const points = ended || !pointer ? path : [...path, snap(pointer)];
      if (path.length === 0) {
        ruler.clear();
        setMeasured(null);
        return;
      }
      const result = measure(scale, points);
      ruler.draw(points, t('ruler.label', { distance: result.distance, unit: distanceUnit }));
      setMeasured({ ...result, points: path.length });
    };
    const add = (point: Point) => {
      const snapped = snap(point);
      const last = path.at(-1);
      // A double click, or a click on the last cell, adds nothing.
      if (last && Math.hypot(last.x - snapped.x, last.y - snapped.y) < 2) return;
      path = [...path, snapped];
    };
    const clear = () => {
      path = [];
      ended = false;
      show();
    };
    const press = (event: FederatedPointerEvent) => {
      if (event.button !== 0) return;
      if (ended) clear();
      const started = path.length === 0;
      if (started) add(viewport.toWorld(event.global));
      pressed = { x: event.global.x, y: event.global.y, started };
      show();
    };
    const follow = (event: FederatedPointerEvent) => {
      if (ended || path.length === 0) return;
      pointer = viewport.toWorld(event.global);
      show();
    };
    const release = (event: FederatedPointerEvent) => {
      if (!pressed) return;
      const dragged = Math.hypot(event.global.x - pressed.x, event.global.y - pressed.y) > 4;
      // The click that starts a path adds no second point; any other click, or a drag, does.
      if (dragged || !pressed.started) add(viewport.toWorld(event.global));
      pressed = null;
      show();
    };
    rulerRef.current = {
      end: () => {
        if (path.length === 0 || ended) return false;
        ended = true;
        show();
        return true;
      },
      undo: () => {
        if (path.length === 0) return false;
        path = path.slice(0, -1);
        if (path.length === 0) ended = false;
        show();
        return true;
      },
      clear: () => {
        if (path.length === 0) return false;
        clear();
        return true;
      },
    };
    viewport.on('pointerdown', press);
    viewport.on('globalpointermove', follow);
    viewport.on('pointerup', release);
    viewport.on('pointerupoutside', release);
    return () => {
      rulerRef.current = null;
      viewport.off('pointerdown', press);
      viewport.off('globalpointermove', follow);
      viewport.off('pointerup', release);
      viewport.off('pointerupoutside', release);
      viewport.plugins.resume('drag');
      ruler.clear();
      setMeasured(null);
    };
  }, [stage, tool, columns, rows, gridType, gridSize, cellDistance, diagonals, distanceUnit]);

  // A click (not a drag) on the map off every token lets go of the selected one.
  const release = useEffectEvent(deselect);
  useEffect(() => {
    if (!stage) return;
    const { viewport, tokens: layer } = stage;
    const clicked = ({ world }: { world: { x: number; y: number } }) => {
      if (!layer.covers(world)) release();
    };
    viewport.on('clicked', clicked);
    return () => {
      viewport.off('clicked', clicked);
    };
  }, [stage]);

  const background =
    url === null ? 'none' : loaded?.url !== url ? 'loading' : loaded.shown ? 'shown' : 'blocked';

  const step = (next: (view: View) => View) => {
    if (!stage) return;
    const panel = screenOf(stage.viewport);
    apply(stage.viewport, clampView(next(viewOf(stage.viewport)), content, panel));
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
        onDoubleClick={() => {
          rulerRef.current?.end();
        }}
        onContextMenu={(event) => {
          // A token's own menu opens from Pixi; the browser's has nothing for the canvas.
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (!stage || event.altKey || event.ctrlKey || event.metaKey) return;
          const selected = tokens.find((token) => token.id === selectedId);
          // The context-menu key or Shift+F10 opens the selected token's menu by the token.
          if (
            selected &&
            (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          ) {
            event.preventDefault();
            const grid = { columns, rows, gridType, gridSize };
            const at = stage.viewport.toScreen(cellCentre(grid, selected));
            openMenu(selected, { x: at.x, y: at.y });
            return;
          }
          // Keys for the ruler's path, while it has one.
          const ruler = rulerRef.current;
          const rulerKeys: Partial<Record<string, () => boolean>> = ruler
            ? { Enter: ruler.end, Backspace: ruler.undo, Escape: ruler.clear }
            : {};
          if (rulerKeys[event.key]?.()) {
            event.preventDefault();
            return;
          }
          // Arrows move the selected token, if the member may move it, else the view.
          const cell = selected?.movable
            ? stepCell({ columns, rows, gridType, gridSize }, selected, event.key)
            : undefined;
          if (selected && cell !== undefined) {
            event.preventDefault();
            if (cell) handlers.move(selected, cell);
            return;
          }
          const panel = screenOf(stage.viewport);
          const next = viewForKey(event.key, viewOf(stage.viewport), content, panel);
          if (!next) return;
          event.preventDefault();
          apply(stage.viewport, next);
        }}
        onDragOver={(event) => {
          if (!stage || !onDropActor || !carriesActor(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          const actorId = droppedActor(event);
          if (!stage || !onDropActor || !actorId) return;
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          const point = stage.viewport.toWorld(event.clientX - box.left, event.clientY - box.top);
          const cell = cellAt({ columns, rows, gridType, gridSize }, point, content);
          if (cell) onDropActor(actorId, cell);
        }}
      />
      <p id={keysId} className="sr-only">
        {t('map.keys')}
      </p>
      <div
        role="toolbar"
        aria-label={t('map.tools')}
        className="absolute top-3 left-3 flex gap-1 rounded-lg bg-surface p-1 shadow"
      >
        {(['select', 'ruler'] as const).map((each) => (
          <Button
            key={each}
            variant={tool === each ? 'primary' : 'ghost'}
            aria-pressed={tool === each}
            disabled={!stage}
            onClick={() => {
              setTool(each);
            }}
          >
            {t(`map.tool.${each}`)}
          </Button>
        ))}
      </div>
      {tool === 'ruler' && (
        <div className="absolute bottom-3 left-3 flex max-w-[60%] flex-col gap-1 rounded-md bg-surface px-3 py-1.5 text-sm shadow">
          <p role="status">
            {measured &&
              t('ruler.measured', {
                distance: measured.distance,
                unit: distanceUnit,
                cells: measured.cells,
                points: measured.points,
              })}
          </p>
          <p className="text-muted">{t('ruler.hint')}</p>
        </div>
      )}
      {menu && (
        <TokenMenu
          token={menu.token}
          at={menu.at}
          actions={actionsFor(menu.token)}
          onClose={() => {
            setMenu(null);
            host.current?.focus();
          }}
        />
      )}
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
            step(() => fitView(content, screenOf(stage?.viewport)));
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

function drawGrid({ grid, viewport }: Stage, scene: SceneGrid): void {
  grid.clear();
  for (const [x1, y1, x2, y2] of gridSegments(scene)) grid.moveTo(x1, y1).lineTo(x2, y2);
  grid.stroke({ width: 1, color: GRID_COLOR, alpha: 0.45, pixelLine: true });
  viewport.dirty = true;
}

/**
 * Gives pixi-viewport the zoom limits too: a wheel or pinch then stops at them with the point
 * under the pointer kept still, where clamping afterwards would leave the map shifted towards
 * the pointer on every turn of the wheel at the limit.
 */
function limitZoom(viewport: Viewport, scene: Size): void {
  const { min, max } = zoomLimits(scene, screenOf(viewport));
  viewport.clampZoom({ minScale: min, maxScale: max });
}

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
