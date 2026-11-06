import { describe, expect, it } from 'vitest';

import type { Setting } from '@vtt/plugin-schema';

import { createRules, scopedSettingValues, settingValues } from '../src/index.js';

const definitions: Record<string, Setting> = {
  bonus: { type: 'integer', default: 1, label: 'Bonus' },
  quality: {
    type: 'string',
    default: 'high',
    enum: ['low', 'high'],
    label: 'Q',
    scope: 'instance',
  },
  colour: { type: 'string', default: 'red', label: 'Colour', scope: 'user' },
};

describe('scopedSettingValues (ADR-075)', () => {
  it('reads each setting from the store of its own scope', () => {
    expect(
      scopedSettingValues(definitions, {
        instance: { quality: 'low', bonus: 9 },
        table: { bonus: 3, colour: 'blue' },
        user: { colour: 'green', quality: 'high' },
      }),
    ).toEqual({ bonus: 3, quality: 'low', colour: 'green' });
  });

  it('falls back to defaults for missing or unfit values', () => {
    expect(
      scopedSettingValues(definitions, { instance: { quality: 'medium' }, table: { bonus: 'x' } }),
    ).toEqual({ bonus: 1, quality: 'high', colour: 'red' });
  });
});

describe('formula settings', () => {
  it('hold only the table scope', () => {
    expect(settingValues(definitions, { bonus: 2 })).toMatchObject({ bonus: 2 });
    const rules = createRules(
      {
        manifest: {
          id: 'mini',
          name: 'Mini',
          version: '1.0.0',
          kind: 'system',
          coreApi: '^0.1.0',
          hasCode: false,
        },
        actorTypes: {},
        itemTypes: {},
        sheets: {},
        rolls: {},
        dice: {},
        cards: {},
        settings: definitions,
        lang: {},
        styles: [],
      },
      { settings: { bonus: 2, colour: 'blue' } },
    );
    expect(rules.settings).toEqual({ bonus: 2 });
  });
});
