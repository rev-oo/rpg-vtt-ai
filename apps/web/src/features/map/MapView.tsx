import { lazy, Suspense, useState, type ReactElement } from 'react';

import { canManageScenes } from '@vtt/shared';
import type { ActorView, FogInput, SceneView, TableView, TokenView } from '@vtt/shared/api';
import { Alert, Button, Select } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

import { AddTokenDialog } from './AddTokenDialog.js';
import type { Cell } from './geometry.js';
import { TokenList } from './TokenList.js';
import type { MenuAction } from './TokenMenu.js';
import { useScenes } from './use-scenes.js';
import { useTokens } from './use-tokens.js';

// Pixi loads only with the map (ADR-067).
const MapCanvas = lazy(() => import('./MapCanvas.js'));

export interface MapViewProps {
  table: TableView;
  /** The actors the member can see: tokens of these open their sheets. */
  actors: readonly ActorView[];
  /** The scene a GM chose to look at; the active one when absent or gone. */
  sceneId: string | null;
  onSceneId: (sceneId: string) => void;
  /** Opens the Scenes panel. */
  onManage: () => void;
  /** Opens an actor's sheet. */
  onOpenActor: (actor: ActorView) => void;
}

/**
 * The scene in the workspace centre (FR-MAP-02): players see the active one. GMs and
 * assistants may look at any, marked as a preview while players do not see it.
 */
export function MapView({
  table,
  sceneId,
  onSceneId,
  onManage,
  ...rest
}: MapViewProps): ReactElement {
  const { scenes, error } = useScenes(table.id);
  const manages = canManageScenes(table.role);
  const active = scenes?.find((scene) => scene.active);
  const scene =
    (manages ? scenes?.find((candidate) => candidate.id === sceneId) : undefined) ??
    active ??
    (manages ? scenes?.[0] : undefined);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (scenes === undefined) return <p className="p-3 text-muted">{t('app.loading')}</p>;
  if (!scene) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted">{t(manages ? 'map.noScenes' : 'map.nothingShown')}</p>
        {manages && <Button onClick={onManage}>{t('map.openScenes')}</Button>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {manages && (
        <div className="flex flex-wrap items-end gap-2 border-b border-line bg-surface px-3 py-2">
          <Select
            label={t('map.scene')}
            value={scene.id}
            className="min-w-48"
            onChange={(event) => {
              onSceneId(event.target.value);
            }}
          >
            {scenes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
          <p className="pb-2 text-sm text-muted" role="status">
            {scene.active ? t('map.shownToPlayers') : t('map.preview')}
          </p>
        </div>
      )}
      {/* A new grid may move the tokens to whole cells (ADR-068), so they are fetched again. */}
      <SceneStage
        key={`${scene.id}:${scene.gridType}`}
        table={table}
        scene={scene}
        manages={manages}
        {...rest}
      />
    </div>
  );
}

interface SceneStageProps {
  table: TableView;
  scene: SceneView;
  manages: boolean;
  actors: readonly ActorView[];
  onOpenActor: (actor: ActorView) => void;
}

/** One scene: its canvas, its tokens and, for GMs, placing them (FR-MAP-03, ADR-068). */
function SceneStage({ table, scene, manages, actors, onOpenActor }: SceneStageProps): ReactElement {
  const { tokens, error, move, change } = useTokens(table.id, scene.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  /** GMs and assistants reveal and hide areas; `scene.updated` brings the new fog (ADR-070). */
  const changeFog = (input: FogInput) => {
    setPlaceError(null);
    api.changeFog(scene.id, input).catch((e: unknown) => {
      setPlaceError(errorMessage(e));
    });
  };
  /** A GM drops an actor from a list on a cell of the map. */
  const place = (actorId: string, { column, row }: Cell) => {
    setPlaceError(null);
    api.createToken(scene.id, { actorId, column, row }).then(
      (token) => {
        setSelectedId(token.id);
        change(token.id, Promise.resolve(token));
      },
      (e: unknown) => {
        setPlaceError(errorMessage(e));
      },
    );
  };
  const actorOf = (token: TokenView) => actors.find((actor) => actor.id === token.actorId);
  const open = (token: TokenView) => {
    const actor = actorOf(token);
    if (actor) onOpenActor(actor);
  };
  const select = (token: TokenView | null) => {
    setSelectedId(token?.id ?? null);
  };
  const hide = (token: TokenView, hidden: boolean) => {
    change(token.id, api.updateToken(token.id, { hidden }));
  };
  const remove = (token: TokenView) => {
    setSelectedId(null);
    change(
      token.id,
      api.deleteToken(token.id).then(() => null),
    );
  };
  /** The token list's actions, for a token's menu on the map (ADR-069). */
  const actionsFor = (token: TokenView): MenuAction[] => [
    ...(actorOf(token)
      ? [
          {
            label: t('tokens.open', { name: token.name }),
            run: () => {
              open(token);
            },
          },
        ]
      : []),
    ...(manages
      ? [
          {
            label: t(token.hidden ? 'tokens.reveal' : 'tokens.hide', { name: token.name }),
            run: () => {
              hide(token, !token.hidden);
            },
          },
          {
            label: t('tokens.remove', { name: token.name }),
            run: () => {
              remove(token);
            },
          },
        ]
      : []),
  ];

  return (
    <>
      {manages && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line bg-surface px-3 py-1">
          <p className="text-sm text-muted">{t('tokens.dropHint')}</p>
          <Button
            variant="ghost"
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('tokens.add')}
          </Button>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {placeError && <Alert tone="error">{placeError}</Alert>}
      <div className="min-h-0 flex-1">
        <Suspense fallback={<p className="p-3 text-muted">{t('app.loading')}</p>}>
          <MapCanvas
            scene={scene}
            tokens={tokens}
            selectedId={selectedId}
            onDropActor={manages ? place : undefined}
            actionsFor={actionsFor}
            onFog={manages ? changeFog : undefined}
            select={select}
            deselect={() => {
              setSelectedId(null);
            }}
            open={open}
            move={(token, { column, row }) => {
              move(token, column, row);
            }}
          />
        </Suspense>
      </div>
      <TokenList
        scene={scene}
        tokens={tokens}
        selectedId={selectedId}
        manages={manages}
        canOpen={(token) => actorOf(token) !== undefined}
        onSelect={select}
        onMove={(token, { column, row }) => {
          move(token, column, row);
        }}
        onOpen={open}
        onHide={hide}
        onRemove={remove}
      />
      {adding && (
        <AddTokenDialog
          open
          actors={actors}
          cell={{ column: Math.floor(scene.columns / 2), row: Math.floor(scene.rows / 2) }}
          onClose={() => {
            setAdding(false);
          }}
          onAdd={async (input) => {
            try {
              const token = await api.createToken(scene.id, input);
              setAdding(false);
              setSelectedId(token.id);
              change(token.id, Promise.resolve(token));
              return null;
            } catch (e) {
              return errorMessage(e);
            }
          }}
        />
      )}
    </>
  );
}
