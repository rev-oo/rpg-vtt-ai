import { lazy, Suspense, type ReactElement } from 'react';

import { canManageScenes } from '@vtt/shared';
import type { TableView } from '@vtt/shared/api';
import { Alert, Button, Select } from '@vtt/ui';

import { t } from '../../i18n/index.js';

import { useScenes } from './use-scenes.js';

// Pixi loads only with the map (ADR-067).
const MapCanvas = lazy(() => import('./MapCanvas.js'));

export interface MapViewProps {
  table: TableView;
  /** The scene a GM chose to look at; the active one when absent or gone. */
  sceneId: string | null;
  onSceneId: (sceneId: string) => void;
  /** Opens the Scenes panel. */
  onManage: () => void;
}

/**
 * The scene in the workspace centre (FR-MAP-02): players see the active one. GMs and
 * assistants may look at any, marked as a preview while players do not see it.
 */
export function MapView({ table, sceneId, onSceneId, onManage }: MapViewProps): ReactElement {
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
      <div className="min-h-0 flex-1">
        <Suspense fallback={<p className="p-3 text-muted">{t('app.loading')}</p>}>
          <MapCanvas key={scene.id} scene={scene} />
        </Suspense>
      </div>
    </div>
  );
}
