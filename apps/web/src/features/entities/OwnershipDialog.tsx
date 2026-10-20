import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';

import { isGmLike, OWNERSHIP_LEVELS, type OwnershipLevel } from '@vtt/shared';
import type { ActorView, MemberView } from '@vtt/shared/api';
import { Alert, Button, Dialog, Select } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

export interface OwnershipDialogProps {
  /** The actor to edit; the dialog is closed while `null`. */
  actor: ActorView | null;
  members: readonly MemberView[];
  onClose: () => void;
  onSaved: (actor: ActorView) => void;
}

const asLevel = (value: string): OwnershipLevel | undefined =>
  OWNERSHIP_LEVELS.find((level) => level === value);

/**
 * Sets who may see and edit an actor (FR-ENT-02, 03): a default level and per-member
 * overrides. GMs and assistants own every actor anyway, so they are not listed.
 */
export function OwnershipDialog({
  actor,
  members,
  onClose,
  onSaved,
}: OwnershipDialogProps): ReactElement {
  return (
    <Dialog
      open={actor !== null}
      title={t('ownership.title', { name: actor?.name ?? '' })}
      onClose={onClose}
    >
      {actor && (
        <OwnershipForm
          key={actor.id}
          actor={actor}
          members={members.filter((m) => !isGmLike(m.role))}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function OwnershipForm({
  actor,
  members,
  onClose,
  onSaved,
}: OwnershipDialogProps & { actor: ActorView }): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      default: actor.ownership.default,
      // `''` follows the default.
      users: members.map((m) => ({
        userId: m.userId,
        level: actor.ownership.users[m.userId] ?? '',
      })),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      const users: Record<string, OwnershipLevel> = {};
      for (const { userId, level } of value.users) {
        const set = asLevel(level);
        if (set) users[userId] = set;
      }
      const ownership = { default: value.default, users };
      try {
        onSaved(await api.updateActor(actor.id, { ownership }));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <form.Field name="default">
        {(field) => (
          <Select
            label={t('ownership.default')}
            value={field.state.value}
            onChange={(e) => {
              const level = asLevel(e.target.value);
              if (level) field.handleChange(level);
            }}
          >
            {OWNERSHIP_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t(`ownership.level.${level}`)}
              </option>
            ))}
          </Select>
        )}
      </form.Field>
      <form.Field name="users">
        {(field) =>
          field.state.value.map((entry) => (
            <Select
              key={entry.userId}
              label={members.find((m) => m.userId === entry.userId)?.displayName ?? entry.userId}
              value={entry.level}
              onChange={(e) => {
                const level = e.target.value;
                field.handleChange(
                  field.state.value.map((other) =>
                    other.userId === entry.userId ? { ...other, level } : other,
                  ),
                );
              }}
            >
              <option value="">{t('ownership.useDefault')}</option>
              {OWNERSHIP_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(`ownership.level.${level}`)}
                </option>
              ))}
            </Select>
          ))
        }
      </form.Field>
      <p className="text-sm text-muted">{t('ownership.gmNote')}</p>
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose}>{t('entities.cancel')}</Button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" variant="primary" disabled={submitting}>
              {t('ownership.save')}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
