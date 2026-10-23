import { describe, expect, it } from 'vitest';

import { catalogueProblems } from '../src/i18n/check.js';
import { en } from '../src/i18n/en.js';
import { pickLocale } from '../src/i18n/index.js';
import { ptBR } from '../src/i18n/pt-BR.js';

describe('message catalogues (T-0606, NFR-11)', () => {
  it('pt-BR has every en key, with the same placeholders', () => {
    expect(catalogueProblems(en, ptBR)).toEqual([]);
  });

  it('flags a missing, extra, empty or misplaced key', () => {
    const reference = { 'a.one': 'One {n}', 'a.two': 'Two', 'a.three': 'Three' };
    const missing = { 'a.one': 'Um {n}', 'a.three': 'Três' };
    expect(catalogueProblems(reference, missing)).toEqual([{ key: 'a.two', problem: 'missing' }]);
    expect(
      catalogueProblems(reference, {
        'a.one': 'Um {count}',
        'a.two': ' ',
        'a.three': 'Três',
        x: 'x',
      }),
    ).toEqual([
      { key: 'a.one', problem: 'placeholders' },
      { key: 'a.two', problem: 'empty' },
      { key: 'x', problem: 'extra' },
    ]);
  });
});

describe('pickLocale', () => {
  it('prefers the chosen language, then the browser’s, then English', () => {
    expect(pickLocale('pt-BR', ['en-US'])).toBe('pt-BR');
    expect(pickLocale(null, ['pt-BR', 'en'])).toBe('pt-BR');
    expect(pickLocale(null, ['pt-PT'])).toBe('pt-BR');
    expect(pickLocale(null, ['fr-FR', 'en-GB'])).toBe('en');
    expect(pickLocale('klingon', ['de'])).toBe('en');
  });
});
