import { useForm } from '@tanstack/react-form';
import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useId,
  useState,
  type ReactElement,
} from 'react';
import { useRevalidator } from 'react-router';

import { canSetOwnership } from '@vtt/shared';
import { createJournalBody, type JournalEntryView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { useJournalBody } from '../../collab/use-journal-body.js';
import { TextInput } from '../../forms/fields.js';
import { t } from '../../i18n/index.js';
import { useTableData } from '../table/table-data.js';

// TipTap is only downloaded once an entry is opened (ADR-037).
const RichTextEditor = lazy(() =>
  import('../../collab/RichTextEditor.js').then((module) => ({ default: module.RichTextEditor })),
);

type EntryState =
  | { status: 'loading' }
  | { status: 'ready'; entry: JournalEntryView }
  | { status: 'failed'; error: string };

/**
 * One journal entry, as a workspace panel: its title and its body, edited together
 * (FR-JOURNAL-01). It loads again whenever the table's data does, so a hidden or deleted
 * entry leaves the screen; such an entry answers 404, like one that never existed (ADR-038).
 */
export function JournalEntryPanel({
  entryId,
  onTitle,
}: {
  entryId: string;
  onTitle: (title: string) => void;
}): ReactElement {
  const data = useTableData();
  const [state, setState] = useState<EntryState>({ status: 'loading' });
  const [reloads, setReloads] = useState(0);
  const showTitle = useEffectEvent(onTitle);

  useEffect(() => {
    let current = true;
    api.getJournalEntry(entryId).then(
      (entry) => {
        if (!current) return;
        setState({ status: 'ready', entry });
        showTitle(entry.title);
      },
      (error: unknown) => {
        if (!current) return;
        const gone = error instanceof ApiError && (error.status === 404 || error.status === 400);
        setState({ status: 'failed', error: gone ? t('journal.notFound') : errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [entryId, data, reloads]);

  if (state.status === 'loading') return <p className="text-muted">{t('app.loading')}</p>;
  if (state.status === 'failed') return <Alert tone="error">{state.error}</Alert>;
  return (
    <JournalEntry
      key={state.entry.id}
      entry={state.entry}
      onChanged={() => {
        setReloads((n) => n + 1);
      }}
    />
  );
}

function JournalEntry({
  entry,
  onChanged,
}: {
  entry: JournalEntryView;
  onChanged: () => void;
}): ReactElement {
  const { table } = useTableData();
  const revalidator = useRevalidator();
  const body = useJournalBody(entry.id);
  const labelId = useId();
  const [failure, setFailure] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const update = async (input: Parameters<typeof api.updateJournalEntry>[1]) => {
    setFailure(null);
    try {
      await api.updateJournalEntry(entry.id, input);
      onChanged();
      // The list shows titles and hidden marks too.
      await revalidator.revalidate();
    } catch (caught) {
      setFailure(errorMessage(caught));
    }
  };

  return (
    <article className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {renaming ? (
          <RenameForm
            title={entry.title}
            onCancel={() => {
              setRenaming(false);
            }}
            onSave={async (title) => {
              await update({ title });
              setRenaming(false);
            }}
          />
        ) : (
          <h2 id={labelId} className="flex-1 text-xl font-bold">
            {entry.title}
          </h2>
        )}
        {!renaming && entry.access === 'owner' && (
          <Button
            onClick={() => {
              setRenaming(true);
            }}
          >
            {t('journal.rename')}
          </Button>
        )}
        {canSetOwnership(table.role) && (
          <Button onClick={() => void update({ hidden: !entry.hidden })}>
            {t(entry.hidden ? 'journal.reveal' : 'journal.hide')}
          </Button>
        )}
      </div>
      {entry.hidden && <Alert tone="info">{t('journal.hiddenBanner')}</Alert>}
      {failure && <Alert tone="error">{failure}</Alert>}
      {body.status === 'connecting' && <p className="text-muted">{t('sheet.loading')}</p>}
      {body.status === 'denied' && <Alert tone="error">{t('journal.notFound')}</Alert>}
      {body.status === 'ready' && (
        <Suspense fallback={<p className="text-muted">{t('sheet.loading')}</p>}>
          <RichTextEditor
            fragment={body.fragment}
            labelId={labelId}
            readOnly={body.readOnly}
            className="min-h-64 rounded-lg border border-line bg-surface p-3"
          />
        </Suspense>
      )}
    </article>
  );
}

const titleSchema = createJournalBody.shape.title;

function RenameForm({
  title,
  onCancel,
  onSave,
}: {
  title: string;
  onCancel: () => void;
  onSave: (title: string) => Promise<void>;
}): ReactElement {
  const form = useForm({
    defaultValues: { title },
    onSubmit: async ({ value }) => {
      await onSave(value.title.trim());
    },
  });
  return (
    <form
      className="flex flex-1 flex-wrap items-end gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="title" validators={{ onChange: titleSchema, onSubmit: titleSchema }}>
        {(field) => (
          <TextInput field={field} label={t('journal.entryTitle')} className="flex-1" required />
        )}
      </form.Field>
      <Button onClick={onCancel}>{t('entities.cancel')}</Button>
      <Button type="submit" variant="primary">
        {t('journal.save')}
      </Button>
    </form>
  );
}
