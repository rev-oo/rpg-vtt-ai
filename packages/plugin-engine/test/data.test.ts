import { describe, expect, it } from 'vitest';

import { collectionRows, defaultSortKey, defaultValue, withDefaults } from '../src/index.js';

import { CHARACTER } from './fixtures.js';

describe('defaults (specs §8.4)', () => {
  it('builds a new entity from the schema defaults', () => {
    expect(withDefaults(CHARACTER.schema, {})).toEqual({
      str: 14,
      dex: 0,
      hp: { value: 10, max: 10 },
      skills: { d0: { name: 'Climb', rank: 2, secretBonus: 0, sort: defaultSortKey(0) } },
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

  it('orders default rows by their sort keys', () => {
    expect(defaultSortKey(0) < defaultSortKey(1)).toBe(true);
    expect(defaultSortKey(35) < defaultSortKey(36)).toBe(true);
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
