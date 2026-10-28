import { useForm } from '@tanstack/react-form';
import { lazy, Suspense, useId, useState, type ReactElement } from 'react';
import { Link, useRevalidator } from 'react-router';

import { canSetOwnership } from '@vtt/shared';
import { createJournalBody, type JournalEntryView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { ApiError } from '../api/client.js';
import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { useJournalBody } from '../collab/use-journal-body.js';
import { useTableData } from '../features/table/table-data.js';
import { useStageLink } from '../features/workspace/stage-link.js';
import { TextInput } from '../forms/fields.js';
import { t } from '../i18n/index.js';

import type { Route } from './+types/table-journal-entry';

// TipTap is only downloaded once an entry is opened (ADR-037).
const RichTextEditor = lazy(() =>
  import('../collab/RichTextEditor.js').then((module) => ({ default: module.RichTextEditor })),
);

type EntryData = { entry: JournalEntryView; error: null } | { entry: null; error: string };

/** A hidden or deleted entry answers 404, like one that never existed (ADR-038). */
export async function clientLoader({ params }: Route.ClientLoaderArgs): Promise<EntryData> {
  try {
    return { entry: await api.getJournalEntry(params.entryId), error: null };
  } catch (error) {
    const gone = error instanceof ApiError && (error.status === 404 || error.status === 400);
    return { entry: null, error: gone ? t('journal.notFound') : errorMessage(error) };
  }
}

/** One journal entry: its title and its body, edited together (FR-JOURNAL-01). */
export default function TableJournalEntryRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const { table } = useTableData();
  const stageLink = useStageLink();
  const back = (
    <Link to={stageLink(`/tables/${table.id}`)} className="self-start">
      {t('journal.back')}
    </Link>
  );
  if (!loaderData.entry) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="error">{loaderData.error}</Alert>
        {back}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {back}
      <JournalEntry key={loaderData.entry.id} entry={loaderData.entry} />
    </div>
  );
}

function JournalEntry({ entry }: { entry: JournalEntryView }): ReactElement {
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
