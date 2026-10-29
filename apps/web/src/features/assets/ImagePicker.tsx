import { useState, type ReactElement } from 'react';

import { imageUrlSchema } from '@vtt/shared/api';
import { Button, Dialog, TextField } from '@vtt/ui';

import { t } from '../../i18n/index.js';

import { AssetGallery } from './AssetGallery.js';

export interface PickedImage {
  url: string;
  /** The asset's file name, for alt text; empty for a typed URL. */
  name: string;
}

export interface ImagePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (image: PickedImage) => void;
  /** Offers "Remove image" when the field has one. */
  onRemove?: () => void;
}

/**
 * Picks an image for an image field (FR-ASSET-02, ADR-065): one of the table's images, a new
 * upload, or any `http(s)` URL.
 */
export function ImagePicker({ open, onClose, onPick, onRemove }: ImagePickerProps): ReactElement {
  const [url, setUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const invalid = !imageUrlSchema.safeParse(url.trim()).success;
  const close = () => {
    setUrl('');
    setSubmitted(false);
    onClose();
  };

  return (
    <Dialog open={open} title={t('image.pickerTitle')} onClose={close}>
      <AssetGallery
        onPick={(asset) => {
          onPick({ url: asset.url, name: asset.name });
          close();
        }}
      />
      <form
        className="flex flex-col gap-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (invalid) return;
          onPick({ url: url.trim(), name: '' });
          close();
        }}
      >
        <TextField
          label={t('image.url')}
          value={url}
          error={submitted && invalid ? t('image.urlInvalid') : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
        />
        <div className="flex flex-wrap justify-end gap-3">
          {onRemove && (
            <Button
              onClick={() => {
                onRemove();
                close();
              }}
            >
              {t('image.remove')}
            </Button>
          )}
          <Button onClick={close}>{t('image.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('image.useUrl')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
