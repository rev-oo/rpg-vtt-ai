import { render, type RenderResult } from '@testing-library/react';

import type { ActorType, SheetNode } from '@vtt/plugin-schema';

import { createMemoryStore, Sheet, type SheetProps, type SheetStore } from '../src/index.js';

export const TYPE: Pick<ActorType, 'schema' | 'derived'> = {
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 10 },
      str: { type: 'integer', default: 14, minimum: 1, maximum: 30 },
      speed: { type: 'number', default: 1.5 },
      alive: { type: 'boolean', default: true },
      size: { type: 'string', enum: ['small', 'large'], default: 'small' },
      hp: {
        type: 'object',
        properties: {
          value: { type: 'integer', default: 10, 'x-counter': true },
          max: { type: 'integer', default: 10 },
        },
      },
      skills: {
        type: 'array',
        'x-kind': 'collection',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, rank: { type: 'integer', default: 1 } },
        },
      },
      notes: { type: 'string', 'x-kind': 'longText' },
      portrait: { type: 'string', 'x-kind': 'image' },
      gmNotes: { type: 'string', 'x-kind': 'longText', 'x-layer': 'secret' },
    },
  },
  derived: { strMod: 'floor((@str - 10) / 2)', weak: '@str < 8', broken: '@nope' },
};

export const TEXTS: Record<string, string> = {
  'field.str': 'Strength',
  'field.hp': 'Hit points',
  'tab.main': 'Main',
  'tab.notes': 'Notes',
  'section.vitals': 'Vitals',
  'roll.skill': 'Roll skill',
  'skill.add': 'Add skill',
  small: 'Small',
  large: 'Large',
};
export const translate = (text: string): string => TEXTS[text] ?? text;

export function renderSheet(
  layout: SheetNode,
  { data = {}, ...props }: Partial<SheetProps> & { data?: Record<string, unknown> } = {},
): RenderResult & { store: SheetStore } {
  const store = props.store ?? createMemoryStore(data);
  const result = render(
    <Sheet
      pluginId="tiny-test"
      layout={layout}
      type={TYPE}
      store={store}
      translate={translate}
      {...props}
    />,
  );
  return { ...result, store };
}
