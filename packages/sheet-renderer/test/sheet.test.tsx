import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SheetNode } from '@vtt/plugin-schema';

import { createMemoryStore, DEFAULT_STRINGS, formatDerived, valueAt } from '../src/index.js';

import { renderSheet } from './fixtures.js';

describe('<Sheet>', () => {
  it('scopes the plugin and reads defaults for missing data', () => {
    const { container } = renderSheet({ type: 'field', path: 'str', label: 'field.str' });
    expect(container.firstElementChild).toHaveAttribute('data-plugin', 'tiny-test');
    expect(screen.getByLabelText('Strength')).toHaveValue('14');
    expect(container.querySelector('[data-field="str"]')).not.toBeNull();
  });

  it('writes valid input and reports invalid input without storing it (FR-SHEET-09)', async () => {
    const { store } = renderSheet({
      type: 'column',
      children: [
        { type: 'field', path: 'str', label: 'field.str' },
        { type: 'field', path: 'speed', label: 'Speed' },
        { type: 'field', path: 'name', label: 'Name' },
      ],
    });
    const user = userEvent.setup();
    const strength = screen.getByLabelText('Strength');

    await user.clear(strength);
    await user.type(strength, '18');
    expect(store.getSnapshot().str).toBe(18);

    await user.type(strength, '0');
    expect(screen.getByText('Must be at most 30.')).toBeInTheDocument();
    expect(strength).toHaveAttribute('aria-invalid', 'true');
    expect(store.getSnapshot().str).toBe(18);

    await user.clear(strength);
    await user.type(strength, '1.5');
    expect(screen.getByText('Enter a whole number.')).toBeInTheDocument();
    await user.clear(strength);
    await user.type(strength, '0');
    expect(screen.getByText('Must be at least 1.')).toBeInTheDocument();
    await user.clear(strength);
    expect(screen.getByText('Enter a number.')).toBeInTheDocument();

    // Typing "1.5" stored the valid "1" on the way; leaving shows the stored value again.
    await user.tab();
    expect(strength).toHaveValue('1');
    expect(store.getSnapshot().str).toBe(1);
    expect(screen.queryByText('Enter a number.')).not.toBeInTheDocument();

    const speed = screen.getByLabelText('Speed');
    await user.clear(speed);
    await user.type(speed, '2.5');
    expect(store.getSnapshot().speed).toBe(2.5);

    await user.type(screen.getByLabelText('Name'), 'Long name here');
    expect(screen.getByText('Must be at most 10 characters.')).toBeInTheDocument();
    expect(store.getSnapshot().name).toBe('Long name ');
  });

  it('infers inputs from the schema and writes checkboxes and selects', async () => {
    const { store } = renderSheet(
      {
        type: 'column',
        children: [
          { type: 'field', path: 'alive', label: 'Alive' },
          { type: 'field', path: 'size', label: 'Size' },
          { type: 'field', path: 'hp.value', label: 'field.hp' },
        ],
      },
      // Seeded as previews do: the memory store does not know defaults.
      { data: { size: 'huge', hp: { value: 10 } } },
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Alive'));
    expect(store.getSnapshot().alive).toBe(false);

    const size = screen.getByLabelText('Size');
    // A stored value outside the enum still shows.
    expect(size).toHaveValue('huge');
    await user.selectOptions(size, 'Large');
    expect(store.getSnapshot().size).toBe('large');

    await user.click(screen.getByRole('button', { name: 'Increase Hit points' }));
    await user.click(screen.getByRole('button', { name: 'Increase Hit points' }));
    await user.click(screen.getByRole('button', { name: 'Decrease Hit points' }));
    expect(valueAt(store.getSnapshot(), ['hp', 'value'])).toBe(11);
  });

  it('steps a counter that is not stored yet with an adjustment (FR-SHEET-08)', async () => {
    const store = createMemoryStore();
    const set = vi.spyOn(store, 'set');
    const adjust = vi.spyOn(store, 'adjust');
    renderSheet({ type: 'field', path: 'hp.value', label: 'field.hp' }, { store });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Decrease Hit points' }));
    // Writing `default - 1` would lose a step made at the same time by someone else.
    expect(adjust).toHaveBeenCalledWith(['hp', 'value'], -1);
    expect(set).not.toHaveBeenCalled();
  });

  it('shows nodes only while visibleIf holds, and hides broken conditions', () => {
    const store = createMemoryStore({ hp: { value: 3 } });
    renderSheet(
      {
        type: 'column',
        children: [
          { type: 'text', text: 'Down!', visibleIf: '@hp.value <= 0' },
          { type: 'text', text: 'Weak', visibleIf: '@derived.weak' },
          { type: 'text', text: 'Broken', visibleIf: '@nope' },
          { type: 'text', text: 'Number', visibleIf: '1' },
        ],
      },
      { store },
    );
    expect(screen.queryByText('Down!')).not.toBeInTheDocument();
    act(() => {
      store.set(['hp', 'value'], 0);
      store.set(['str'], 4);
    });
    expect(screen.getByText('Down!')).toBeInTheDocument();
    expect(screen.getByText('Weak')).toBeInTheDocument();
    expect(screen.queryByText('Broken')).not.toBeInTheDocument();
    expect(screen.queryByText('Number')).not.toBeInTheDocument();
  });

  it('updates derived values live and marks failed ones (FR-SHEET-05)', () => {
    const store = createMemoryStore();
    renderSheet(
      {
        type: 'row',
        children: [
          { type: 'derived', key: 'strMod', label: 'Mod', format: 'signed' },
          { type: 'derived', key: 'broken' },
          { type: 'derived', key: 'undefinedName' },
        ],
      },
      { store },
    );
    expect(screen.getByRole('status', { name: 'Mod' })).toHaveTextContent('+2');
    act(() => {
      store.set(['str'], 6);
    });
    expect(screen.getByRole('status', { name: 'Mod' })).toHaveTextContent('−2');
    expect(screen.getByRole('status', { name: 'broken' })).toHaveTextContent('—');
    expect(screen.getByRole('status', { name: 'broken' })).toHaveAttribute(
      'title',
      expect.stringContaining('@nope'),
    );
    expect(screen.getByRole('status', { name: 'undefinedName' })).toHaveTextContent('—');
  });

  it('formats derived values', () => {
    expect(formatDerived(2.6, 'integer')).toBe('3');
    expect(formatDerived(0, 'signed')).toBe('+0');
    expect(formatDerived(1.23456, 'decimal')).toBe('1.23');
    expect(formatDerived(1.5, undefined)).toBe('1.5');
    expect(formatDerived(true, 'signed')).toBe('true');
    expect(formatDerived([1, 2], undefined)).toBe('1, 2');
  });

  it('omits secret fields unless the viewer may see them (FR-SHEET-04)', () => {
    const layout: SheetNode = { type: 'longText', path: 'gmNotes', label: 'GM notes' };
    const { unmount } = renderSheet(layout);
    expect(screen.queryByLabelText('GM notes')).not.toBeInTheDocument();
    unmount();
    renderSheet(layout, { secret: true, data: { gmNotes: 'The butler did it' } });
    expect(screen.getByLabelText('GM notes')).toHaveValue('The butler did it');
  });

  it('shows read-only sheets without changing anything (FR-SHEET-03)', async () => {
    const onRoll = vi.fn();
    const { store, container } = renderSheet(
      {
        type: 'column',
        children: [
          { type: 'field', path: 'str', label: 'field.str' },
          { type: 'field', path: 'alive', label: 'Alive' },
          { type: 'longText', path: 'notes', label: 'Notes' },
          { type: 'rollButton', roll: 'skill', label: 'roll.skill' },
        ],
      },
      { readOnly: true, onRoll },
    );
    expect(container.firstElementChild).toHaveAttribute('data-readonly', 'true');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Strength'), '9');
    await user.type(screen.getByLabelText('Notes'), 'x');
    expect(screen.getByLabelText('Alive')).toBeDisabled();
    expect(store.getSnapshot()).toEqual({});
    // Rolls change no data, so they follow onRoll alone.
    await user.click(screen.getByRole('button', { name: 'Roll skill' }));
    expect(onRoll).toHaveBeenCalledWith('skill', {});
  });

  it('edits text areas', () => {
    const { store } = renderSheet({ type: 'longText', path: 'notes', label: 'Notes' });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Line one\nLine two' } });
    expect(store.getSnapshot().notes).toBe('Line one\nLine two');
  });

  it('loads only safe image URLs', () => {
    const layout: SheetNode = { type: 'image', path: 'portrait' };
    const urls = [
      '/plugins/x/a.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      '//evil.test/a.png',
    ];
    const shown = urls.map((portrait) => {
      const { container, unmount } = renderSheet(layout, { data: { portrait } });
      const src = container.querySelector('img')?.getAttribute('src') ?? null;
      unmount();
      return src;
    });
    expect(shown).toEqual(['/plugins/x/a.png', 'data:image/png;base64,AAAA', null, null]);
  });

  it('lets editors pick an image field through the host, and remove it (ADR-065)', async () => {
    const layout: SheetNode = { type: 'image', path: 'portrait' };
    let answer: string | null = '/api/v1/assets/11111111-1111-4111-8111-111111111111';
    const pickImage = vi.fn((done: (url: string | null) => void) => {
      done(answer);
    });
    const { store, container } = renderSheet(layout, { pickImage });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Choose image' }));
    expect(pickImage).toHaveBeenCalledWith(expect.any(Function), '');
    expect(store.getSnapshot().portrait).toBe(answer);
    expect(container.querySelector('img')).toHaveAttribute('src', answer);

    answer = null;
    await user.click(screen.getByRole('button', { name: 'Change image' }));
    expect(pickImage).toHaveBeenLastCalledWith(
      expect.any(Function),
      '/api/v1/assets/11111111-1111-4111-8111-111111111111',
    );
    expect(store.getSnapshot().portrait).toBe('');
    expect(screen.getByText('Choose image')).toBeInTheDocument();
  });

  it('shows image fields without a button to observers or without a host picker', () => {
    const layout: SheetNode = { type: 'image', path: 'portrait' };
    const { unmount } = renderSheet(layout, { pickImage: vi.fn(), readOnly: true });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('No image')).toBeInTheDocument();
    unmount();
    renderSheet(layout);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('switches tabs with the mouse and the arrow keys', async () => {
    renderSheet({
      type: 'tabs',
      tabs: [
        { label: 'tab.main', children: [{ type: 'text', text: 'Main body' }] },
        { label: 'tab.notes', children: [{ type: 'text', text: 'Notes body' }] },
      ],
    });
    const user = userEvent.setup();
    expect(screen.getByRole('tab', { name: 'Main' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Main body')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByText('Notes body')).toBeInTheDocument();
    expect(screen.queryByText('Main body')).not.toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Main' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Main' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('x');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('collapses collapsible sections', async () => {
    renderSheet({
      type: 'section',
      title: 'section.vitals',
      collapsible: true,
      children: [{ type: 'text', text: 'Inside' }],
    });
    const details = screen.getByText('Vitals').closest('details');
    expect(details).toHaveAttribute('open');
    await userEvent.setup().click(screen.getByText('Vitals'));
    expect(details).not.toHaveAttribute('open');
  });
});

describe('lists (FR-SHEET-06)', () => {
  const layout: SheetNode = {
    type: 'list',
    path: 'skills',
    addLabel: 'skill.add',
    item: {
      type: 'row',
      children: [
        { type: 'field', path: 'name', label: 'Skill' },
        {
          type: 'rollButton',
          roll: 'skill',
          label: 'roll.skill',
          args: { id: '@row.id', rank: '@row.rank' },
        },
      ],
    },
  };
  const names = () =>
    screen.getAllByLabelText('Skill').map((input) => (input as HTMLInputElement).value);

  it('adds rows with defaults, edits, reorders and removes them', async () => {
    const onRoll = vi.fn();
    const { store } = renderSheet(layout, { onRoll });
    const user = userEvent.setup();
    expect(screen.getByText(DEFAULT_STRINGS.noRows)).toBeInTheDocument();

    for (const name of ['Climb', 'Swim', 'Sneak']) {
      await user.click(screen.getByRole('button', { name: 'Add skill' }));
      const inputs = screen.getAllByLabelText('Skill');
      await user.type(inputs.at(-1) ?? document.body, name);
    }
    expect(names()).toEqual(['Climb', 'Swim', 'Sneak']);
    expect(valueAt(store.getSnapshot(), ['skills', 'r1'])).toMatchObject({
      name: 'Climb',
      rank: 1,
    });

    const rows = () => screen.getAllByRole('listitem');
    await user.click(within(rows()[2] ?? document.body).getByRole('button', { name: 'Move up' }));
    expect(names()).toEqual(['Climb', 'Sneak', 'Swim']);
    await user.click(within(rows()[0] ?? document.body).getByRole('button', { name: 'Move down' }));
    expect(names()).toEqual(['Sneak', 'Climb', 'Swim']);
    await user.click(within(rows()[1] ?? document.body).getByRole('button', { name: 'Move down' }));
    expect(names()).toEqual(['Sneak', 'Swim', 'Climb']);
    expect(
      within(rows()[0] ?? document.body).getByRole('button', { name: 'Move up' }),
    ).toBeDisabled();
    expect(
      within(rows()[2] ?? document.body).getByRole('button', { name: 'Move down' }),
    ).toBeDisabled();

    await user.click(
      within(rows()[1] ?? document.body).getByRole('button', { name: 'Roll skill' }),
    );
    expect(onRoll).toHaveBeenCalledWith('skill', { id: 'r2', rank: 1 });

    await user.click(within(rows()[1] ?? document.body).getByRole('button', { name: 'Remove' }));
    expect(names()).toEqual(['Sneak', 'Climb']);
    expect(Object.keys(store.getSnapshot().skills as object)).toEqual(['r1', 'r3']);
  });

  it('disables roll buttons whose arguments fail', () => {
    renderSheet(
      { type: 'rollButton', roll: 'skill', label: 'roll.skill', args: { id: '@row.id' } },
      { onRoll: vi.fn() },
    );
    const button = screen.getByRole('button', { name: 'Roll skill' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('@row.id'));
  });

  it('hides list controls when read-only', () => {
    renderSheet(layout, { readOnly: true, data: { skills: { a: { name: 'Climb', sort: 'i' } } } });
    expect(names()).toEqual(['Climb']);
    expect(screen.queryByRole('button', { name: 'Add skill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

describe('custom nodes (specs §8.10)', () => {
  it('renders the plugin component with its props and row', () => {
    renderSheet(
      {
        type: 'list',
        path: 'skills',
        item: { type: 'custom:badge', props: { tone: 'gold' } },
      },
      {
        data: { skills: { a: { sort: 'i' } } },
        nodes: {
          badge: ({ props, rowPath }) => (
            <span>{`${String(props.tone)} ${rowPath?.join('/') ?? ''}`}</span>
          ),
        },
      },
    );
    expect(screen.getByText('gold skills/a')).toBeInTheDocument();
  });

  it('explains a component that is not available', () => {
    renderSheet({ type: 'custom:hpBar' });
    expect(screen.getByText(/needs the plugin “hpBar” component/)).toBeInTheDocument();
  });
});

describe('createMemoryStore()', () => {
  it('notifies subscribers and stops when they leave', () => {
    const store = createMemoryStore();
    const listener = vi.fn();
    const leave = store.subscribe(listener);
    store.set(['a', 'b'], 1);
    expect(store.getSnapshot()).toEqual({ a: { b: 1 } });
    leave();
    store.adjust(['a', 'b'], 2);
    store.adjust(['c'], -1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ a: { b: 3 }, c: -1 });
  });

  it('moves rows to the end, and ignores unknown targets', () => {
    const store = createMemoryStore(
      {},
      {
        newId: (() => {
          let n = 0;
          return () => `id${String((n += 1))}`;
        })(),
      },
    );
    const first = store.addRow(['rows'], { v: 1 });
    store.addRow(['rows'], { v: 2 });
    store.moveRow(['rows'], first, null);
    const order = () =>
      Object.entries(store.getSnapshot().rows as Record<string, { sort: string }>)
        .sort(([, a], [, b]) => (a.sort < b.sort ? -1 : 1))
        .map(([id]) => id);
    expect(order()).toEqual(['id2', 'id1']);
    store.moveRow(['rows'], first, 'missing');
    expect(order()).toEqual(['id2', 'id1']);
    store.set([], 'ignored');
    expect(valueAt(store.getSnapshot(), ['rows', 'id1', 'v'])).toBe(1);
  });
});

describe('presence (FR-SHEET-02)', () => {
  const layout: SheetNode = {
    type: 'column',
    children: [
      { type: 'field', path: 'str', label: 'field.str' },
      { type: 'field', path: 'hp.value', label: 'field.hp' },
      {
        type: 'list',
        path: 'skills',
        item: { type: 'field', path: 'name', label: 'Skill' },
      },
    ],
  };

  it('outlines fields others are in and reports where the viewer is', async () => {
    const focus = vi.fn();
    const lena = { id: 'u2', name: 'Lena', color: 'rgb(200, 0, 0)' };
    const at = (path: readonly string[]) =>
      path.join('.') === 'skills.r1.name' || path.join('.') === 'str' ? [lena] : [];
    renderSheet(layout, {
      data: { skills: { r1: { name: 'Climb', sort: 'i' } } },
      presence: { at, focus },
    });

    const strength = screen.getByLabelText('Strength');
    const shell = strength.closest('[data-field]');
    expect(shell).toHaveStyle({ outline: '2px solid rgb(200, 0, 0)' });
    expect(within(shell as HTMLElement).getByText('Lena')).toBeInTheDocument();
    // Badges take no room and let clicks through, so controls never move under a pointer.
    expect(shell?.querySelector('[data-presence]')).toHaveClass('absolute', 'pointer-events-none');
    const row = screen.getByLabelText('Skill').closest('[data-field]');
    expect(within(row as HTMLElement).getByText('Lena')).toBeInTheDocument();
    const hp = screen.getByLabelText('Hit points').closest('[data-field]');
    expect(hp?.querySelector('[data-presence]')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Hit points'));
    expect(focus).toHaveBeenLastCalledWith(['hp', 'value']);
    // The counter's buttons are part of the same field.
    await user.click(screen.getByRole('button', { name: 'Increase Hit points' }));
    expect(focus).toHaveBeenLastCalledWith(['hp', 'value']);
    await user.click(screen.getByLabelText('Skill'));
    expect(focus).toHaveBeenLastCalledWith(['skills', 'r1', 'name']);
    await user.click(document.body);
    expect(focus).toHaveBeenLastCalledWith(null);
  });
});
