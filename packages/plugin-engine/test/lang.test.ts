import { describe, expect, it } from 'vitest';

import { langText } from '../src/lang.js';

// T-1611: plugin texts posted by lang key, with parameters.

const TEXTS: Record<string, string> = {
  'chat.save': '{name} saves with {ability}: {total}.',
  'ability.dex': 'Dexterity',
};
const translate = (text: string) => TEXTS[text] ?? text;

describe('langText (T-1611)', () => {
  it('fills parameters, translating those that are lang keys', () => {
    expect(
      langText(translate, 'chat.save', { name: 'Mira', ability: 'ability.dex', total: 14 }),
    ).toBe('Mira saves with Dexterity: 14.');
  });

  it('keeps placeholders without a parameter, and keys without a text', () => {
    expect(langText(translate, 'chat.save', { name: 'Mira' })).toBe(
      'Mira saves with {ability}: {total}.',
    );
    expect(langText(translate, 'chat.unknown', { name: 'Mira' })).toBe('chat.unknown');
  });
});
