import { lazy, Suspense, useCallback, useMemo, type ReactElement } from 'react';

import type { Value } from '@vtt/formula';
import { documentLayout } from '@vtt/plugin-engine';
import type { ActorView, ItemView } from '@vtt/shared/api';
import type { RichTextProps } from '@vtt/sheet-renderer';
import { Alert } from '@vtt/ui';

import { useSheetPresence } from '../../collab/presence.js';
import { useLiveSheet } from '../../collab/use-live-sheet.js';
import { t } from '../../i18n/index.js';
import { entityType } from '../../plugin-host/entity-type.js';
import { PluginSheet } from '../../plugin-host/PluginSheet.js';
import type { TableSystem } from '../../plugin-host/system-context.js';
import { useSession } from '../../shell/use-session.js';
import { useTableData } from '../table/table-data.js';

type ReadySystem = Extract<TableSystem, { status: 'ready' }>;

// The editor and ProseMirror load only for sheets with rich text (ADR-037).
const RichTextEditor = lazy(() =>
  import('../../collab/RichTextEditor.js').then((module) => ({ default: module.RichTextEditor })),
);

const NO_FIELDS = { main: {}, secret: undefined };

/**
 * An actor's or item's sheet over its live documents (T-0506, ADR-062), with presence and
 * rich text. Edits need `owner` access and a writable document.
 */
export function LiveEntitySheet({
  host,
  kind,
  entity,
  secret,
  onRoll,
}: {
  host: ReadySystem;
  kind: 'actor' | 'item';
  entity: ActorView | ItemView;
  secret: boolean;
  onRoll?: ((name: string, args: Readonly<Record<string, Value>>) => void) | undefined;
}): ReactElement {
  const type = entityType(host.system.definition, kind, entity.type);
  const layout = useMemo(() => (type ? documentLayout(type.schema) : NO_FIELDS), [type]);
  const live = useLiveSheet({ kind, id: entity.id }, layout, { secret });
  const { members } = useTableData();
  const userId = useSession().user?.id ?? '';
  const presence = useSheetPresence(live.status === 'ready' ? live.awareness : undefined, {
    userId,
    members,
  });
  const store = live.status === 'ready' ? live.store : undefined;
  const renderRichText = useCallback(
    ({ path, ...props }: RichTextProps) => {
      const fragment = store?.richText(path);
      return (
        fragment && (
          <Suspense fallback={<p className="text-muted">{t('sheet.loading')}</p>}>
            <RichTextEditor key={path.join('.')} fragment={fragment} {...props} />
          </Suspense>
        )
      );
    },
    [store],
  );

  if (live.status === 'denied') {
    return <Alert tone="error">{t(kind === 'item' ? 'items.notFound' : 'sheet.notFound')}</Alert>;
  }
  if (live.status === 'connecting') return <p className="text-muted">{t('sheet.connecting')}</p>;
  return (
    <>
      {live.issues.length > 0 && (
        <Alert tone="info">{t('sheet.repaired', { count: live.issues.length })}</Alert>
      )}
      <PluginSheet
        host={host}
        actor={entity}
        kind={kind}
        store={live.store}
        presence={presence}
        renderRichText={renderRichText}
        readOnly={live.readOnly || entity.access !== 'owner'}
        secret={secret}
        onRoll={onRoll}
      />
    </>
  );
}
