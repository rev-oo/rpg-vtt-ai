import { useEffect, useRef, useState, type ReactElement } from 'react';

import {
  ASSET_TYPES,
  assetInUseDetailsSchema,
  type AssetUse,
  type AssetView,
} from '@vtt/shared/api';
import { Alert, Button, Dialog } from '@vtt/ui';

import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { useTableData } from '../table/table-data.js';

import { useCanManageAssets } from './use-can-manage-assets.js';

export interface AssetGalleryProps {
  /** Picks an image instead of only showing it, as in the image picker. */
  onPick?: (asset: AssetView) => void;
}

/**
 * The table's images (FR-ASSET-02, ADR-065): thumbnails, newest first. Those who manage
 * them upload by picking or dropping files, and delete images nothing uses.
 */
export function AssetGallery({ onPick }: AssetGalleryProps): ReactElement {
  const data = useTableData();
  const tableId = data.table.id;
  const canManage = useCanManageAssets();
  const [assets, setAssets] = useState<AssetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<AssetView | null>(null);
  const [inUse, setInUse] = useState<{ name: string; uses: AssetUse[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Loads again with the table's data, so others' uploads show up.
  useEffect(() => {
    let current = true;
    api.listAssets(tableId).then(
      (list) => {
        if (current) setAssets(list);
      },
      (caught: unknown) => {
        if (current) setError(errorMessage(caught));
      },
    );
    return () => {
      current = false;
    };
  }, [tableId, data]);

  const uploadAll = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setInUse(null);
    setStatus(t('assets.uploading'));
    const added: AssetView[] = [];
    try {
      for (const file of files) {
        added.unshift(await api.uploadAsset(tableId, file));
      }
      setStatus(t('assets.uploaded', { count: added.length }));
    } catch (caught) {
      setStatus(null);
      setError(errorMessage(caught));
    } finally {
      setAssets((list) => [...added, ...(list ?? [])]);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (asset: AssetView) => {
    setDeleting(null);
    setError(null);
    setInUse(null);
    try {
      await api.deleteAsset(asset.id);
      setAssets((list) => list?.filter((a) => a.id !== asset.id) ?? null);
      setStatus(t('assets.deleted', { name: asset.name }));
    } catch (caught) {
      setStatus(null);
      const uses =
        caught instanceof ApiError && caught.code === 'asset_in_use'
          ? assetInUseDetailsSchema.safeParse(caught.details).data?.uses
          : undefined;
      if (uses) setInUse({ name: asset.name, uses });
      else setError(errorMessage(caught));
    }
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg ${dragging ? 'outline-2 outline-primary outline-dashed' : ''}`}
      onDragOver={(event) => {
        if (!canManage || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!canManage) return;
        event.preventDefault();
        setDragging(false);
        void uploadAll([...event.dataTransfer.files]);
      }}
    >
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            multiple
            accept={ASSET_TYPES.join(',')}
            className="sr-only"
            tabIndex={-1}
            aria-label={t('assets.uploadFile')}
            onChange={(event) => {
              void uploadAll([...(event.target.files ?? [])]);
            }}
          />
          <Button
            disabled={busy}
            onClick={() => {
              input.current?.click();
            }}
          >
            {t('assets.upload')}
          </Button>
          <p className="text-sm text-muted">{t('assets.drop')}</p>
        </div>
      )}
      {status && (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {inUse && (
        <Alert tone="error">
          {t('assets.inUse', { name: inUse.name })}
          <ul className="mt-1 list-disc pl-5">
            {inUse.uses.map((use) => (
              <li key={`${use.kind}:${use.id}`}>
                {t(`assets.use.${use.kind}`, { name: use.name })}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {assets === null && !error && <p className="text-muted">{t('app.loading')}</p>}
      {assets?.length === 0 && <p className="text-muted">{t('assets.empty')}</p>}
      {assets && assets.length > 0 && (
        <ul
          aria-label={t('assets.list')}
          className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2"
        >
          {assets.map((asset) => (
            <li
              key={asset.id}
              aria-label={asset.name}
              className="flex min-w-0 flex-col gap-1 rounded-lg border border-line p-1"
            >
              {onPick ? (
                <button
                  type="button"
                  className="cursor-pointer rounded hover:outline-2 hover:outline-primary"
                  aria-label={t('assets.pick', { name: asset.name })}
                  onClick={() => {
                    onPick(asset);
                  }}
                >
                  <Thumbnail asset={asset} />
                </button>
              ) : (
                <Thumbnail asset={asset} />
              )}
              <p className="truncate text-xs" title={asset.name}>
                {asset.name}
              </p>
              {canManage && !onPick && (
                <button
                  type="button"
                  className="cursor-pointer self-start text-xs text-danger underline"
                  aria-label={t('assets.delete', { name: asset.name })}
                  onClick={() => {
                    setDeleting(asset);
                  }}
                >
                  {t('assets.deleteShort')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={deleting !== null}
        title={t('assets.deleteTitle')}
        onClose={() => {
          setDeleting(null);
        }}
      >
        <p>{t('assets.deleteBody', { name: deleting?.name ?? '' })}</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            onClick={() => {
              setDeleting(null);
            }}
          >
            {t('assets.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (deleting) void remove(deleting);
            }}
          >
            {t('assets.deleteConfirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Thumbnail({ asset }: { asset: AssetView }): ReactElement {
  return (
    <img
      src={asset.url}
      alt=""
      loading="lazy"
      className="aspect-square w-full rounded bg-canvas object-contain"
    />
  );
}
