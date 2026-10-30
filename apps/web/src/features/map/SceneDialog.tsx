import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';
import { z } from 'zod';

import {
  DIAGONAL_RULES,
  GRID_TYPES,
  imageUrlSchema,
  sceneUpdateBody,
  type SceneCreateInput,
  type SceneView,
} from '@vtt/shared/api';
import { Alert, Button, Dialog } from '@vtt/ui';

import { SelectInput, TextInput } from '../../forms/fields.js';
import { t } from '../../i18n/index.js';
import { ImagePicker } from '../assets/ImagePicker.js';

const fields = sceneUpdateBody.shape;
/** The form's number fields hold text, as inputs do. */
const whole = (schema: z.ZodNumber) => z.coerce.number<string>().pipe(schema);
/** A decimal number as typed, with a point or a comma. */
const toDecimal = (value: string) => Number(value.trim().replace(',', '.'));
const decimal = (schema: z.ZodNumber) => z.string().transform(toDecimal).pipe(schema);
const schemas = {
  name: fields.name.unwrap(),
  backgroundUrl: z.union([z.literal(''), imageUrlSchema]),
  columns: whole(fields.columns.unwrap()),
  rows: whole(fields.rows.unwrap()),
  gridSize: whole(fields.gridSize.unwrap()),
  cellDistance: decimal(fields.cellDistance.unwrap()),
  distanceUnit: fields.distanceUnit.unwrap(),
};

export interface SceneDialogProps {
  open: boolean;
  /** The scene to edit; a new one when absent. */
  scene?: SceneView | undefined;
  onClose: () => void;
  /** Saves the scene, answering with what went wrong, if anything. */
  onSave: (input: Required<SceneCreateInput>) => Promise<string | null>;
}

/** A scene's name, background and grid (FR-MAP-01). */
export function SceneDialog({ open, scene, onClose, onSave }: SceneDialogProps): ReactElement {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gridType: string = scene?.gridType ?? 'square';
  const diagonals: string = scene?.diagonals ?? 'one';
  const form = useForm({
    defaultValues: {
      name: scene?.name ?? '',
      backgroundUrl: scene?.backgroundUrl ?? '',
      columns: String(scene?.columns ?? 30),
      rows: String(scene?.rows ?? 20),
      gridType,
      gridSize: String(scene?.gridSize ?? 70),
      cellDistance: String(scene?.cellDistance ?? 5),
      distanceUnit: scene?.distanceUnit ?? 'ft',
      diagonals,
    },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      const background = value.backgroundUrl.trim();
      const failure = await onSave({
        name: value.name.trim(),
        backgroundUrl: background === '' ? null : background,
        columns: Number(value.columns),
        rows: Number(value.rows),
        gridType: GRID_TYPES.find((type) => type === value.gridType) ?? 'square',
        gridSize: Number(value.gridSize),
        cellDistance: toDecimal(value.cellDistance),
        distanceUnit: value.distanceUnit.trim(),
        diagonals: DIAGONAL_RULES.find((rule) => rule === value.diagonals) ?? 'one',
      });
      if (failure === null) formApi.reset();
      else setError(failure);
    },
  });

  const number = (name: 'columns' | 'rows' | 'gridSize', label: string, hint: string) => (
    <form.Field name={name} validators={{ onChange: schemas[name], onSubmit: schemas[name] }}>
      {(field) => (
        <TextInput field={field} label={label} hint={hint} inputMode="numeric" required />
      )}
    </form.Field>
  );

  return (
    <>
      <Dialog
        open={open}
        title={scene ? t('scenes.editTitle', { name: scene.name }) : t('scenes.new')}
        onClose={onClose}
      >
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {error && <Alert tone="error">{error}</Alert>}
          <form.Field name="name" validators={{ onChange: schemas.name, onSubmit: schemas.name }}>
            {(field) => <TextInput field={field} label={t('scenes.name')} required />}
          </form.Field>
          <form.Field
            name="backgroundUrl"
            validators={{ onChange: schemas.backgroundUrl, onSubmit: schemas.backgroundUrl }}
          >
            {(field) => (
              <div className="flex flex-col gap-2">
                <TextInput
                  field={field}
                  label={t('scenes.background')}
                  hint={t('scenes.backgroundHint')}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      setPicking(true);
                    }}
                  >
                    {t('scenes.chooseBackground')}
                  </Button>
                  {field.state.value !== '' && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        field.handleChange('');
                      }}
                    >
                      {t('scenes.removeBackground')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </form.Field>
          <div className="grid grid-cols-2 gap-3">
            {number('columns', t('scenes.columns'), t('scenes.cellsHint'))}
            {number('rows', t('scenes.rows'), t('scenes.cellsHint'))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <form.Field name="gridType">
              {(field) => (
                <SelectInput field={field} label={t('scenes.gridType')}>
                  {GRID_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`scenes.grid.${type}`)}
                    </option>
                  ))}
                </SelectInput>
              )}
            </form.Field>
            {number('gridSize', t('scenes.gridSize'), t('scenes.gridSizeHint'))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <form.Field
              name="cellDistance"
              validators={{ onChange: schemas.cellDistance, onSubmit: schemas.cellDistance }}
            >
              {(field) => (
                <TextInput
                  field={field}
                  label={t('scenes.cellDistance')}
                  hint={t('scenes.cellDistanceHint')}
                  inputMode="decimal"
                  required
                />
              )}
            </form.Field>
            <form.Field
              name="distanceUnit"
              validators={{ onChange: schemas.distanceUnit, onSubmit: schemas.distanceUnit }}
            >
              {(field) => <TextInput field={field} label={t('scenes.distanceUnit')} required />}
            </form.Field>
          </div>
          <form.Field name="diagonals">
            {(field) => (
              <SelectInput field={field} label={t('scenes.diagonals')}>
                {DIAGONAL_RULES.map((rule) => (
                  <option key={rule} value={rule}>
                    {t(`scenes.diagonals.${rule}`)}
                  </option>
                ))}
              </SelectInput>
            )}
          </form.Field>
          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={onClose}>{t('entities.cancel')}</Button>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(submitting) => (
                <Button type="submit" variant="primary" disabled={submitting}>
                  {scene ? t('scenes.save') : t('scenes.create')}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </Dialog>
      {/* Beside the dialog, not in it: React would pass the picker's close event up to it. */}
      <ImagePicker
        open={picking}
        onClose={() => {
          setPicking(false);
        }}
        onPick={({ url }) => {
          form.setFieldValue('backgroundUrl', url);
        }}
      />
    </>
  );
}
