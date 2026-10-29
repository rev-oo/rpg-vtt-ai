import { useState, type ReactElement } from 'react';

import { Button } from '@vtt/ui';

import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

import { ImagePicker } from './ImagePicker.js';

/**
 * An actor's or item's image beside its sheet's title (FR-ASSET-02); whoever edits the entity
 * changes it through the image picker.
 */
export function EntityImage({
  name,
  imageUrl,
  editable,
  onChange,
}: {
  /** The entity's name, which the button names: a sheet may have image fields of its own. */
  name: string;
  imageUrl: string | null;
  editable: boolean;
  /** Saves the new image, or `null` to remove it. */
  onChange: (imageUrl: string | null) => Promise<unknown>;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!imageUrl && !editable) return null;
  const save = (next: string | null) => {
    setError(null);
    onChange(next).catch((caught: unknown) => {
      setError(errorMessage(caught));
    });
  };

  return (
    <div className="flex items-center gap-2">
      {imageUrl && (
        <img src={imageUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
      )}
      {editable && (
        <>
          <Button
            variant="ghost"
            aria-label={t(imageUrl ? 'image.changeFor' : 'image.chooseFor', { name })}
            onClick={() => {
              setOpen(true);
            }}
          >
            {imageUrl ? t('image.change') : t('image.choose')}
          </Button>
          <ImagePicker
            open={open}
            onClose={() => {
              setOpen(false);
            }}
            onPick={({ url }) => {
              save(url);
            }}
            {...(imageUrl && {
              onRemove: () => {
                save(null);
              },
            })}
          />
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
