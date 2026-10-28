import { useEffect, useRef, type ReactElement } from 'react';

import { Select, TextField } from '@vtt/ui';

import { t } from '../../i18n/index.js';

import type { EntityFilters as Filters } from './filters.js';

/** Typing pauses this long before the list reloads. */
const SEARCH_DELAY_MS = 250;

export interface ListFiltersProps {
  searchLabel: string;
  value: Filters;
  onChange: (filters: Filters) => void;
  /** Omitted for lists without types, such as the journal. */
  types?: readonly string[];
}

/**
 * Search, type filter and trash toggle (FR-ENT-04). Each change rebuilds the filters from the
 * form itself, so a late search keystroke never drops a filter chosen meanwhile.
 */
export function ListFilters({
  searchLabel,
  value,
  onChange,
  types,
}: ListFiltersProps): ReactElement {
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
    onChange({ search: text('q'), type: text('type'), trash: form.get('trash') === '1' });
  };

  const { type, trash } = value;

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
        defaultValue={value.search}
        onChange={() => {
          clearTimeout(timer.current);
          timer.current = setTimeout(apply, SEARCH_DELAY_MS);
        }}
      />
      {/* Uncontrolled, so they react at once while the list loads; the key resets them when
          the filters change another way. */}
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
