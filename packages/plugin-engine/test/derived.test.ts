import { describe, expect, it } from 'vitest';

import { computeDerived, withDefaults } from '../src/index.js';

import { CHARACTER } from './fixtures.js';

const data = withDefaults(CHARACTER.schema, {
  str: 17,
  skills: { a: { rank: 3, sort: 'a0' }, b: { rank: 4, sort: 'a1' } },
});

describe('computeDerived() (specs §8.4)', () => {
  it('computes values after the derived values they read', () => {
    const { values, errors } = computeDerived(CHARACTER.derived ?? {}, data, {
      settings: { bonus: 2 },
    });
    expect(values).toEqual({ attack: 5, strMod: 3, skillTotal: 7 });
    expect(errors).toEqual({});
  });

  it('uses shared functions', () => {
    const { values } = computeDerived({ carry: 'carry(@str)' }, data, {
      functions: { carry: (str) => Number(str) * 15 },
    });
    expect(values.carry).toBe(255);
  });

  it('reports a failing value and the values that read it, and computes the rest', () => {
    const { values, errors } = computeDerived(
      {
        broken: '@missing + 1',
        reader: '@derived.broken * 2',
        unparsable: '1 +',
        readsUnparsable: '@derived.unparsable',
        fine: '@str',
      },
      data,
    );
    expect(values).toEqual({ fine: 17 });
    expect(errors.broken?.code).toBe('unknown_reference');
    expect(errors.reader?.code).toBe('depends_on_failed');
    expect(errors.reader?.message).toMatch(/^broken: /);
    expect(errors.unparsable?.code).toBeDefined();
    expect(errors.readsUnparsable?.code).toBe('depends_on_failed');
  });

  it('fails a cycle instead of looping', () => {
    const { values, errors } = computeDerived(
      { a: '@derived.b + 1', b: '@derived.a + 1', c: '@derived.c', d: '2' },
      data,
    );
    expect(values).toEqual({ d: 2 });
    expect(Object.keys(errors).sort()).toEqual(['a', 'b', 'c']);
    expect(errors.c?.code).toBe('cycle');
  });

  it('cannot read settings or derived values the type does not define', () => {
    const { errors } = computeDerived({ a: '@settings.nope', b: '@derived.nope' }, data);
    expect(errors.a?.code).toBe('unknown_reference');
    expect(errors.b?.code).toBe('unknown_reference');
  });
});
