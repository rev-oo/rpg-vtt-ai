import { useState, type ReactElement } from 'react';

import type { SceneCreateInput, SceneView } from '@vtt/shared/api';
import { Alert, Button, Dialog } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

import { SceneDialog } from './SceneDialog.js';
import { useScenes } from './use-scenes.js';

/** `undefined`: closed; `null`: a new scene. */
type Editing = SceneView | null | undefined;

/**
 * The table's scenes for GMs and assistants (FR-MAP-01, ADR-066): make, edit, order and
 * delete them, and choose the one players see.
 */
export function ScenesManager({ tableId }: { tableId: string }): ReactElement {
  const { scenes, error, settle } = useScenes(tableId);
  const [editing, setEditing] = useState<Editing>(undefined);
  const [deleting, setDeleting] = useState<SceneView | null>(null);

  const save = async (input: Required<SceneCreateInput>): Promise<string | null> => {
    try {
      if (editing) await api.updateScene(editing.id, input);
      else await api.createScene(tableId, input);
    } catch (e) {
      return errorMessage(e);
    }
    setEditing(undefined);
    void settle(Promise.resolve(null));
    return null;
  };

  const move = (list: SceneView[], index: number, by: -1 | 1) => {
    const ids = list.map((scene) => scene.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + by, 0, moved);
    void settle(api.orderScenes(tableId, ids));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
          }}
        >
          {t('scenes.new')}
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {scenes === undefined ? (
        <p className="text-muted">{t('app.loading')}</p>
      ) : scenes.length === 0 ? (
        <p className="text-muted">{t('scenes.empty')}</p>
      ) : (
        <ol aria-label={t('scenes.title')} className="flex flex-col gap-2">
          {scenes.map((scene, index) => (
            <li
              key={scene.id}
              aria-label={scene.name}
              className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="min-w-0 truncate font-semibold">{scene.name}</h3>
                {scene.active && (
                  <span className="rounded-full bg-info-soft px-2 text-sm">
                    {t('scenes.shown')}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted">
                {t('scenes.summary', {
                  columns: scene.columns,
                  rows: scene.rows,
                  grid: t(`scenes.grid.${scene.gridType}`),
                })}
              </p>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant={scene.active ? 'secondary' : 'primary'}
                  aria-label={t(scene.active ? 'scenes.hideOf' : 'scenes.showOf', {
                    name: scene.name,
                  })}
                  onClick={() => {
                    void settle(api.setActiveScene(tableId, scene.active ? null : scene.id));
                  }}
                >
                  {t(scene.active ? 'scenes.hide' : 'scenes.show')}
                </Button>
                <Button
                  variant="ghost"
                  aria-label={t('scenes.editOf', { name: scene.name })}
                  onClick={() => {
                    setEditing(scene);
                  }}
                >
                  {t('scenes.edit')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={t('scenes.moveUp', { name: scene.name })}
                  onClick={() => {
                    move(scenes, index, -1);
                  }}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  disabled={index === scenes.length - 1}
                  aria-label={t('scenes.moveDown', { name: scene.name })}
                  onClick={() => {
                    move(scenes, index, 1);
                  }}
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  aria-label={t('scenes.deleteOf', { name: scene.name })}
                  onClick={() => {
                    setDeleting(scene);
                  }}
                >
                  {t('scenes.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {editing !== undefined && (
        <SceneDialog
          key={editing?.id ?? 'new'}
          open
          scene={editing ?? undefined}
          onClose={() => {
            setEditing(undefined);
          }}
          onSave={save}
        />
      )}
      <Dialog
        open={deleting !== null}
        title={t('scenes.deleteTitle')}
        onClose={() => {
          setDeleting(null);
        }}
      >
        <div className="flex flex-col gap-4">
          <p>{t('scenes.deleteBody', { name: deleting?.name ?? '' })}</p>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              onClick={() => {
                setDeleting(null);
              }}
            >
              {t('entities.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!deleting) return;
                const id = deleting.id;
                setDeleting(null);
                void settle(api.deleteScene(id).then(() => null));
              }}
            >
              {t('scenes.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
