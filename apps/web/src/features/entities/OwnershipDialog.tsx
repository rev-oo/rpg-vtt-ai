import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';

import { isGmLike, OWNERSHIP_LEVELS, type OwnershipLevel } from '@vtt/shared';
import type { ActorView, MemberView } from '@vtt/shared/api';
import { Alert, Button, Dialog, Select } from '@vtt/ui';

import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

/** An actor or a journal entry: anything with an ownership map (FR-ENT-02, FR-JOURNAL-02). */
export interface Owned {
  id: string;
  name: string;
  ownership: ActorView['ownership'];
}

export interface OwnershipDialogProps {
  /** What to edit; the dialog is closed while `null`. */
  target: Owned | null;
  members: readonly MemberView[];
  onClose: () => void;
  /** Stores the new ownership; a rejection is shown in the dialog. */
  onSave: (ownership: Owned['ownership']) => Promise<void>;
}

const asLevel = (value: string): OwnershipLevel | undefined =>
  OWNERSHIP_LEVELS.find((level) => level === value);

/**
 * Sets who may see and edit an actor or a journal entry (FR-ENT-02, 03, FR-JOURNAL-02): a
 * default level and per-member overrides. GMs and assistants own everything anyway, so they
 * are not listed.
 */
export function OwnershipDialog({
  target,
  members,
  onClose,
  onSave,
}: OwnershipDialogProps): ReactElement {
  return (
    <Dialog
      open={target !== null}
      title={t('ownership.title', { name: target?.name ?? '' })}
      onClose={onClose}
    >
      {target && (
        <OwnershipForm
          key={target.id}
          target={target}
          members={members.filter((m) => !isGmLike(m.role))}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Dialog>
  );
}

function OwnershipForm({
  target,
  members,
  onClose,
  onSave,
}: OwnershipDialogProps & { target: Owned }): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      default: target.ownership.default,
      // `''` follows the default.
      users: members.map((m) => ({
        userId: m.userId,
        level: target.ownership.users[m.userId] ?? '',
      })),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      const users: Record<string, OwnershipLevel> = {};
      for (const { userId, level } of value.users) {
        const set = asLevel(level);
        if (set) users[userId] = set;
      }
      try {
        await onSave({ default: value.default, users });
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
