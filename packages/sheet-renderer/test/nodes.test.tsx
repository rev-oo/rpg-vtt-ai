import { describe, expect, it } from 'vitest';

import type { SheetNode } from '@vtt/plugin-schema';

import { renderSheet } from './fixtures.js';

const field = (
  path: string,
  extra: Partial<Extract<SheetNode, { type: 'field' }>> = {},
): SheetNode => ({
  type: 'field',
  path,
  ...extra,
});

// One snapshot per node type of specs §8.5.
const NODES: Record<string, SheetNode> = {
  row: {
    type: 'row',
    gap: 'sm',
    wrap: true,
    class: 'stats',
    children: [field('str'), field('speed')],
  },
  column: {
    type: 'column',
    gap: 'lg',
    children: [
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
    ],
  },
  grid: { type: 'grid', columns: 3, children: [field('str'), field('speed'), field('alive')] },
  tabs: {
    type: 'tabs',
    tabs: [
      { label: 'tab.main', children: [field('str', { label: 'field.str' })] },
      { label: 'tab.notes', children: [{ type: 'longText', path: 'notes' }] },
    ],
  },
  section: {
    type: 'section',
    title: 'section.vitals',
    class: 'vitals',
    children: [field('hp.max')],
  },
  'section (collapsible)': {
    type: 'section',
    title: 'section.vitals',
    collapsible: true,
    children: [],
  },
  'field (text)': field('name', { input: 'text', label: 'Name' }),
  'field (number)': field('str', { input: 'number', label: 'field.str' }),
  'field (checkbox)': field('alive', { input: 'checkbox' }),
  'field (select)': field('size', { input: 'select' }),
  'field (counter)': field('hp.value', { input: 'counter', label: 'field.hp' }),
  longText: { type: 'longText', path: 'notes', label: 'Notes' },
  list: {
    type: 'list',
    path: 'skills',
    addLabel: 'skill.add',
    item: { type: 'row', children: [field('name'), field('rank')] },
  },
  rollButton: { type: 'rollButton', roll: 'skill', label: 'roll.skill', args: { bonus: 2 } },
  derived: { type: 'derived', key: 'strMod', label: 'Modifier', format: 'signed' },
  image: { type: 'image', path: 'portrait', size: 'sm' },
  text: { type: 'text', text: 'hint.unconscious', class: 'hint' },
  custom: { type: 'custom:hpBar', props: { color: 'red' } },
};

const DATA = {
  name: 'Ayla',
  portrait: 'https://example.com/ayla.png',
  skills: { a: { name: 'Climb', rank: 2, sort: 'i' }, b: { name: 'Swim', rank: 1, sort: 'r' } },
};

describe('node snapshots (specs §8.5)', () => {
  it.each(Object.entries(NODES))('%s', (_, node) => {
    const { asFragment } = renderSheet(node, {
      data: DATA,
      onRoll: () => undefined,
      nodes: { hpBar: ({ props }) => <meter data-color={String(props.color)} /> },
    });
    expect(asFragment()).toMatchSnapshot();
  });

  it('read-only', () => {
    const { asFragment } = renderSheet(
      {
        type: 'column',
        children: [NODES.list ?? field('x'), NODES['field (counter)'] ?? field('x')],
      },
      { data: DATA, readOnly: true },
    );
    expect(asFragment()).toMatchSnapshot();
  });
});

// A counter keeps room for its value between its buttons (T-1620).
describe('field widths in rows and grids', () => {
  it('asks a row for more room for a counter than for an input, and none for a checkbox', () => {
    const { container } = renderSheet({
      type: 'row',
      children: [field('hp.value'), field('str'), field('alive')],
    });
    const basis = (path: string) =>
      container
        .querySelector<HTMLElement>(`[data-field="${path}"]`)
        ?.style.getPropertyValue('--vtt-basis');
    // The counter comes from the schema's `x-counter`, without `input` on the node.
    expect(container.querySelector('[data-field="hp.value"]')).toHaveAttribute(
      'data-input',
      'counter',
    );
    expect(basis('hp.value')).toBe('9rem');
    expect(basis('str')).toBe('6rem');
    expect(basis('alive')).toBe('auto');
    expect(container.querySelector('.vtt-row')).toHaveClass('@md:flex-wrap');
  });

  it('gives a grid holding a counter wider columns, so it wraps to fewer', () => {
    const columns = (layout: SheetNode) =>
      renderSheet(layout).container.querySelector<HTMLElement>('.vtt-grid')?.style
        .gridTemplateColumns ?? '';
    expect(
      columns({ type: 'grid', columns: 8, children: [field('str'), field('speed')] }),
    ).toContain('max(7rem');
    expect(
      columns({
        type: 'grid',
        columns: 8,
        children: [field('str'), { type: 'column', children: [field('hp.value')] }],
      }),
    ).toContain('max(9rem');
  });
});
