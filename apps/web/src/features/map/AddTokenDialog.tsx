import { useState, type ReactElement } from 'react';

import type { ActorView, TokenCreateInput } from '@vtt/shared/api';
import { Alert, Button, Dialog, Select, TextField } from '@vtt/ui';

import { t } from '../../i18n/index.js';

export interface AddTokenDialogProps {
  open: boolean;
  actors: readonly ActorView[];
  /** Where the token goes: the scene's middle cell. */
  cell: { column: number; row: number };
  onClose: () => void;
  /** Places the token, answering with what went wrong, if anything. */
  onAdd: (input: TokenCreateInput) => Promise<string | null>;
}

const ALONE = '';

/** A token for an actor, or one standing alone with a name (FR-MAP-03). */
export function AddTokenDialog({
  open,
  actors,
  cell,
  onClose,
  onAdd,
}: AddTokenDialogProps): ReactElement {
  const [actorId, setActorId] = useState(actors[0]?.id ?? ALONE);
  const [name, setName] = useState('');
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missingName = actorId === ALONE && name.trim() === '';

  return (
    <Dialog open={open} title={t('tokens.add')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (missingName) {
            setError(t('tokens.nameNeeded'));
            return;
          }
          const input: TokenCreateInput =
            actorId === ALONE
              ? { name: name.trim(), ...cell, hidden }
              : { actorId, ...cell, hidden };
          void onAdd(input).then(setError);
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Select
          label={t('tokens.actor')}
          value={actorId}
          onChange={(event) => {
            setActorId(event.target.value);
          }}
        >
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
          <option value={ALONE}>{t('tokens.alone')}</option>
        </Select>
        {actorId === ALONE && (
          <TextField
            label={t('tokens.name')}
            value={name}
            required
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => {
              setHidden(event.target.checked);
            }}
          />
          {t('tokens.startHidden')}
        </label>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onClose}>{t('entities.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('tokens.place')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
