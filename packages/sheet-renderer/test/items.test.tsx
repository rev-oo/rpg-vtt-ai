import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { FieldSchema, SheetNode } from '@vtt/plugin-schema';

import { createMemoryStore, ItemRow, type ItemsRenderer } from '../src/index.js';

import { renderSheet, TYPE } from './fixtures.js';

// T-1206 (FR-SHEET-12, ADR-063): the host lays out `items` nodes, one `ItemRow` per item.

const ARMOR: FieldSchema = {
  type: 'object',
  properties: {
    equipped: { type: 'boolean', default: false },
    bonus: { type: 'integer', default: 2 },
    curse: { type: 'string', default: 'itchy', 'x-layer': 'secret' },
  },
};

const ROW: SheetNode = {
  type: 'column',
  children: [
    { type: 'field', path: 'equipped', label: 'Equipped', input: 'checkbox' },
    { type: 'field', path: 'curse', label: 'Curse' },
    { type: 'text', text: 'Strong wearer', visibleIf: "@str > 12 and @item.type == 'armor'" },
    { type: 'text', text: 'Named', visibleIf: "@item.name == 'Mail'" },
  ],
};

describe('items nodes (T-1206)', () => {
  it('shows nothing without a host', () => {
    const { container } = renderSheet({ type: 'items', item: ROW });
    expect(container.querySelector('.vtt-sheet')?.childElementCount).toBe(0);
  });

  it("edits the item's store, reading the holder and @item in formulas", async () => {
    const item = createMemoryStore({ bonus: 3 });
    const renderItems: ItemsRenderer = ({ node }) => (
      <section aria-label="Gear">
        <ItemRow
          item={{ id: 'i1', name: 'Mail', type: 'armor' }}
          store={item}
          schema={ARMOR}
          readOnly={false}
          layout={node.item}
        />
      </section>
    );
    const { store } = renderSheet({ type: 'items', item: ROW }, { renderItems, secret: true });
    const gear = screen.getByRole('region', { name: 'Gear' });
    expect(within(gear).getByText('Strong wearer')).toBeVisible();
    expect(within(gear).getByText('Named')).toBeVisible();
    // The item's secret fields stay on its own sheet, even for GMs.
    expect(within(gear).queryByLabelText('Curse')).toBeNull();

    await userEvent.click(within(gear).getByLabelText('Equipped'));
    expect(item.getSnapshot()).toEqual({ bonus: 3, equipped: true });
    expect(store.getSnapshot()).toEqual({});
  });

  it('keeps a read-only item read-only', () => {
    const renderItems: ItemsRenderer = ({ node }) => (
      <ItemRow
        item={{ id: 'i1', name: 'Mail', type: 'armor' }}
        store={createMemoryStore({})}
        schema={ARMOR}
        readOnly
        layout={node.item}
      />
    );
    renderSheet({ type: 'items', item: ROW }, { renderItems });
    expect(screen.getByLabelText('Equipped')).toBeDisabled();
  });

  it('feeds item totals to derived values', () => {
    renderSheet(
      { type: 'derived', key: 'ac', label: 'AC' },
      { type: { ...TYPE, derived: { ac: '10 + @items.acBonus' } }, itemTotals: { acBonus: 4 } },
    );
    expect(screen.getByText('14')).toBeVisible();
  });
});
