import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { canCopyCompendiumToTable, canSeeGmContent } from '@vtt/shared';
import type { CompendiumEntry, CompendiumPack, CompendiumQuery } from '@vtt/shared/api';
import { Alert, Button, Select, TextField } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { PluginSheet } from '../../plugin-host/PluginSheet.js';
import { useSystem } from '../../plugin-host/system-context.js';
import { EntityRow } from '../entities/EntityRow.js';
import { GroupedList } from '../entities/GroupedList.js';
import { groupItems, useItemTypes, type OtherRows } from '../entities/item-groups.js';
import { LoadMore } from '../entities/LoadMore.js';
import { LIST_PAGE, usePagedList } from '../entities/paging.js';
import { useTableData } from '../table/table-data.js';
import { usePanelList } from '../workspace/use-panel-list.js';

/** Typing pauses this long before the list reloads. */
const SEARCH_DELAY_MS = 250;

interface Filters {
  search: string;
  pack: string;
  /** `<kind>:<type>`, or empty for every type. */
  type: string;
}

const NO_FILTERS: Filters = { search: '', pack: '', type: '' };

function toQuery({ search, pack, type }: Filters): CompendiumQuery {
  const [kind, name] = type.split(':');
  return {
    ...(search && { search }),
    ...(pack && { pack }),
    ...((kind === 'actor' || kind === 'item') && name && { kind, type: name }),
    limit: LIST_PAGE,
  };
}

/**
 * The compendium (FR-PLUGIN-09, ADR-060): every entry of the system's packs, with a preview of
 * its sheet. GMs and assistants copy entries into the table; anyone copies items onto an actor
 * they own.
 */
export function CompendiumBrowser(): ReactElement {
  const data = useTableData();
  const { table, types, actors } = data;
  const system = useSystem();
  const { itemTypes, translate } = useItemTypes();
  const revalidator = useRevalidator();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [packs, setPacks] = useState<readonly CompendiumPack[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const toTable = canCopyCompendiumToTable(table.role);
  const targets = actors.filter((actor) => actor.access === 'owner');

  const query = toQuery(filters);
  const list = usePanelList(
    () =>
      api.compendiumPage(table.id, query).then((page) => {
        setPacks(page.packs);
        return page;
      }),
    JSON.stringify(query),
    data,
  );
  const paged = usePagedList(list.rows, list.nextCursor, (cursor) =>
    api.compendiumPage(table.id, { ...query, cursor }),
  );

  const copy = async (entry: CompendiumEntry, onto?: { id: string; name: string }) => {
    setFailure(null);
    try {
      await api.copyFromCompendium(table.id, {
        refs: [entry.ref],
        ...(onto && { actorId: onto.id }),
      });
      setStatus(
        onto
          ? t('compendium.copiedOnto', { name: entry.name, actor: onto.name })
          : t('compendium.copied', { name: entry.name }),
      );
      await revalidator.revalidate();
    } catch (caught) {
      setStatus(null);
      setFailure(errorMessage(caught));
    }
  };

  const packLabel = (name: string) => {
    const pack = packs.find((candidate) => candidate.name === name);
    return pack ? translate(pack.label) : name;
  };

  return (
    <div className="flex flex-col gap-4">
      <CompendiumFilters
        packs={packs}
        actorTypes={types.actorTypes.map(({ type }) => type)}
        itemTypes={types.itemTypes}
        translate={translate}
        onChange={setFilters}
      />
      {(list.error ?? paged.error ?? failure) && (
        <Alert tone="error">{list.error ?? paged.error ?? failure}</Alert>
      )}
      {status && (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      )}
      {list.loaded && paged.rows.length === 0 && !list.error && (
        <p className="text-muted">{t('compendium.empty')}</p>
      )}
      {!list.loaded && <p className="text-muted">{t('app.loading')}</p>}

      <GroupedList
        label={t('compendium.entries')}
        groups={groupItems(paged.rows, (entry) => entry.type, itemTypes, translate, ACTOR_ROWS)}
        rowKey={(entry) => entry.ref}
        renderRow={(entry, nested) => (
          <EntityRow
            key={entry.ref}
            nested={nested}
            name={entry.name}
            type={entry.type}
            imageUrl={null}
            details={
              <>
                <span>{packLabel(entry.pack)}</span>
                {entry.inTable && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{t('compendium.inTable')}</span>
                  </>
                )}
              </>
            }
            actions={
              <>
                {toTable && (
                  <Button
                    aria-label={t('compendium.copyToTableOf', { name: entry.name })}
                    onClick={() => void copy(entry)}
                  >
                    {t('compendium.copyToTable')}
                  </Button>
                )}
                {entry.kind === 'item' && targets.length > 0 && (
                  <CopyOnto entry={entry} targets={targets} onCopy={(onto) => copy(entry, onto)} />
                )}
              </>
            }
          >
            <details>
              <summary className="cursor-pointer text-sm">
                {t('compendium.preview')}
                <span className="sr-only">: {entry.name}</span>
              </summary>
              <div className="mt-2">
                {system.status === 'ready' ? (
                  <PluginSheet
                    host={system}
                    actor={{
                      id: entry.ref,
                      name: entry.name,
                      type: entry.type,
                      system: entry.system,
                    }}
                    kind={entry.kind}
                    readOnly
                    secret={canSeeGmContent(table.role)}
                  />
                ) : (
                  <p className="text-sm text-muted">{t('compendium.noPreview')}</p>
                )}
              </div>
            </details>
          </EntityRow>
        )}
      />
      {paged.more && <LoadMore loading={paged.loading} onLoad={paged.loadMore} />}
    </div>
  );
}

/** Pack actors come before the item groups, under one heading (ADR-061). */
const ACTOR_ROWS: OtherRows<CompendiumEntry> = {
  get title() {
    return t('compendium.actors');
  },
  order: Number.NEGATIVE_INFINITY,
  has: (entry) => entry.kind === 'actor',
};

/** Search, pack and type, applied as they change. */
function CompendiumFilters({
  packs,
  actorTypes,
  itemTypes,
  translate,
  onChange,
}: {
  packs: readonly CompendiumPack[];
  actorTypes: readonly string[];
  itemTypes: readonly string[];
  translate: (text: string) => string;
  onChange: (filters: Filters) => void;
}): ReactElement {
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const apply = () => {
    clearTimeout(timer.current);
    if (!formRef.current) return;
    const form = new FormData(formRef.current);
    const text = (key: string) => {
      const entry = form.get(key);
      return typeof entry === 'string' ? entry.trim() : '';
    };
    onChange({ search: text('q'), pack: text('pack'), type: text('type') });
  };

  return (
    <form
      ref={formRef}
      role="search"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <TextField
        type="search"
        name="q"
        label={t('compendium.search')}
        className="min-w-48 flex-1"
        onChange={() => {
          clearTimeout(timer.current);
          timer.current = setTimeout(apply, SEARCH_DELAY_MS);
        }}
      />
      {packs.length > 1 && (
        <Select name="pack" label={t('compendium.pack')} defaultValue="" onChange={apply}>
          <option value="">{t('compendium.allPacks')}</option>
          {packs.map((pack) => (
            <option key={pack.name} value={pack.name}>
              {translate(pack.label)}
            </option>
          ))}
        </Select>
      )}
      <Select name="type" label={t('entities.type')} defaultValue="" onChange={apply}>
        <option value="">{t('entities.allTypes')}</option>
        <optgroup label={t('actors.title')}>
          {actorTypes.map((type) => (
            <option key={`actor:${type}`} value={`actor:${type}`}>
              {type}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('items.title')}>
          {itemTypes.map((type) => (
            <option key={`item:${type}`} value={`item:${type}`}>
              {type}
            </option>
          ))}
        </optgroup>
      </Select>
    </form>
  );
}

/** Copies an item entry onto one of the caller's actors. */
function CopyOnto({
  entry,
  targets,
  onCopy,
}: {
  entry: CompendiumEntry;
  targets: readonly { id: string; name: string }[];
  onCopy: (onto: { id: string; name: string }) => Promise<void>;
}): ReactElement {
  const [actorId, setActorId] = useState(targets[0]?.id ?? '');
  const target = targets.find((actor) => actor.id === actorId) ?? targets[0];
  const id = `copy-onto-${entry.ref}`;
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={id}>
        {t('compendium.copyOntoOf', { name: entry.name })}
      </label>
      <select
        id={id}
        className="min-h-10 rounded-lg border border-line bg-surface px-2 text-fg"
        value={target?.id ?? ''}
        onChange={(e) => {
          setActorId(e.target.value);
        }}
      >
        {targets.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name}
          </option>
        ))}
      </select>
      <Button
        aria-label={t('compendium.copyOntoButton', { name: entry.name })}
        onClick={() => {
          if (target) void onCopy(target);
        }}
      >
        {t('compendium.copyOnto')}
      </Button>
    </div>
  );
}
