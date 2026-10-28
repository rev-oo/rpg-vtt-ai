import { useEffect, useRef, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { Select, TextField } from '@vtt/ui';

import { t } from '../../i18n/index.js';

/** Typing pauses this long before the list reloads. */
const SEARCH_DELAY_MS = 250;

export interface EntityFiltersProps {
  searchLabel: string;
  /** Omitted for lists without types, such as the journal. */
  types?: readonly string[];
}

/**
 * Search, type filter and trash toggle; they live in the URL (FR-ENT-04). Each change
 * rebuilds the query from the form itself, so a late search keystroke never drops a filter
 * chosen meanwhile.
 */
export function EntityFilters({ searchLabel, types }: EntityFiltersProps): ReactElement {
  const [params, setParams] = useSearchParams();
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
    const form = formRef.current;
    if (!form) return;
    const next = new URLSearchParams();
    // The browse panel's tab is not a filter (ADR-059).
    const panel = params.get('panel');
    if (panel) next.set('panel', panel);
    for (const [key, value] of new FormData(form)) {
      if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
    }
    setParams(next, { replace: true });
  };

  const type = params.get('type') ?? '';
  const trash = params.get('trash') === '1';

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
        label={searchLabel}
        className="min-w-48 flex-1"
        defaultValue={params.get('q') ?? ''}
        onChange={() => {
          clearTimeout(timer.current);
          timer.current = setTimeout(apply, SEARCH_DELAY_MS);
        }}
      />
      {/* Uncontrolled, so they react at once while the list loads; the key resets them when
          the URL changes another way (back, forward, a link). */}
      {types && (
        <Select
          key={`type-${type}`}
          name="type"
          label={t('entities.type')}
          defaultValue={type}
          onChange={apply}
        >
          <option value="">{t('entities.allTypes')}</option>
          {types.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      )}
      <label className="flex min-h-10 items-center gap-2">
        <input
          key={`trash-${String(trash)}`}
          type="checkbox"
          name="trash"
          value="1"
          defaultChecked={trash}
          onChange={apply}
        />
        {t('entities.showTrash')}
      </label>
    </form>
  );
}
