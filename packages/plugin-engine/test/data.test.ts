import { describe, expect, it } from 'vitest';

import {
  collectionRows,
  defaultValue,
  sortKeyBetween,
  sortKeys,
  withDefaults,
} from '../src/index.js';

import { CHARACTER } from './fixtures.js';

describe('defaults (specs §8.4)', () => {
  it('builds a new entity from the schema defaults', () => {
    expect(withDefaults(CHARACTER.schema, {})).toEqual({
      str: 14,
      dex: 0,
      hp: { value: 10, max: 10 },
      skills: { d0: { name: 'Climb', rank: 2, secretBonus: 0, sort: 'i' } },
      tags: [],
      notes: '',
      portrait: '',
      gmNotes: '',
      alive: false,
    });
  });

  it('fills in only what stored data leaves out, at every depth and in every row', () => {
    const data = withDefaults(CHARACTER.schema, {
      str: 8,
      hp: { value: 3 },
      skills: { abc: { name: 'Swim', sort: 'a5' } },
      extra: 'kept',
    });
    expect(data).toMatchObject({
      str: 8,
      dex: 0,
      hp: { value: 3, max: 10 },
      skills: { abc: { name: 'Swim', rank: 0, secretBonus: 0, sort: 'a5' } },
      extra: 'kept',
    });
    // A value of the wrong shape is left for the store to repair (specs §9.7).
    expect(withDefaults(CHARACTER.schema, { hp: 'broken' }).hp).toBe('broken');
    expect(withDefaults(CHARACTER.schema, null).str).toBe(14);
  });

  it('copies defaults so entities never share them', () => {
    const field = { type: 'array' as const, default: ['a'] };
    const first = defaultValue(field) as string[];
    first.push('b');
    expect(defaultValue(field)).toEqual(['a']);
    expect(defaultValue({ type: 'object', default: { a: 1 } })).toEqual({ a: 1 });
    expect(defaultValue({ type: 'array', 'x-kind': 'collection' })).toEqual({});
  });
});

describe('sort keys (specs §9.4)', () => {
  it('gives default rows increasing keys', () => {
    const keys = sortKeys(40);
    expect(keys.slice(0, 3)).toEqual(['i', 'r', 'w']);
    expect([...keys].sort((a, b) => (a < b ? -1 : 1))).toEqual(keys);
    expect(new Set(keys).size).toBe(40);
  });

  it('finds a key between any two neighbours', () => {
    const cases: [string | null, string | null][] = [
      [null, null],
      [null, 'i'],
      ['i', null],
      ['i', 'r'],
      ['i', 'j'],
      ['i', 'i1'],
      ['iz', 'j'],
      ['a1', 'a2'],
      [null, '1'],
      ['z', null],
      ['zzz', null],
    ];
    for (const [before, after] of cases) {
      const key = sortKeyBetween(before, after);
      if (before !== null) expect(key > before, `${before} < ${key}`).toBe(true);
      if (after !== null) expect(key < after, `${key} < ${after}`).toBe(true);
      expect(key).toMatch(/[1-9a-z]$/);
    }
  });

  it('keeps inserting between ever closer keys', () => {
    let low = 'i';
    const high = 'j';
    for (let step = 0; step < 50; step += 1) {
      const key = sortKeyBetween(low, high);
      expect(key > low && key < high).toBe(true);
      low = key;
    }
  });

  it('ignores keys that are not sort keys or out of order', () => {
    expect(sortKeyBetween('a0000', null)).toBe('i');
    expect(sortKeyBetween('r', 'i')).toBe(sortKeyBetween('r', null));
  });
});

describe('collectionRows() (specs §9.4)', () => {
  it('lists rows with their ids in sort order', () => {
    const rows = collectionRows({
      b: { name: 'B', sort: 'a2' },
      a: { name: 'A', sort: 'a1' },
      c: { name: 'C', sort: 'a1' },
      broken: 3,
      unsorted: { name: 'U' },
    });
    expect(rows.map((row) => row.id)).toEqual(['unsorted', 'a', 'c', 'b']);
    expect(rows[1]).toEqual({ id: 'a', name: 'A', sort: 'a1' });
    expect(collectionRows('nope')).toEqual([]);
  });
});
