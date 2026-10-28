import { describe, expect, it } from 'vitest';

import type { ActorView, ItemView, JournalEntryView } from '@vtt/shared/api';

import type { Client } from './support/app.js';
import { setupTable, type TableSetup } from './support/table.js';

// T-0812 (§10.1, ADR-057): cursor pages for actor, item and journal lists.

const NAMES = ['zed', 'Alpha', 'alpha', 'Élan', 'beta', 'Beta', 'Gamma', 'delta', 'eta', 'Ω'];

interface Page<T> {
  list: T[];
  nextCursor: string | null;
}

/** Every page of a list, walked with `limit`, joined. */
async function walk<T>(
  read: (query: string) => Promise<Page<T>>,
  limit: number,
): Promise<{ all: T[]; sizes: number[] }> {
  const all: T[] = [];
  const sizes: number[] = [];
  let cursor: string | null = null;
  do {
    const query = `?limit=${String(limit)}${cursor ? `&cursor=${cursor}` : ''}`;
    const page: Page<T> = await read(query);
    all.push(...page.list);
    sizes.push(page.list.length);
    cursor = page.nextCursor;
  } while (cursor);
  return { all, sizes };
}

const actorsOf = (t: TableSetup, client: Client) => async (query: string) => {
  const res = await t.call(client, 'GET', `/tables/${t.table.id}/actors${query}`);
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json<{ actors: ActorView[]; nextCursor: string | null }>();
  return { list: body.actors.map((a) => a.name), nextCursor: body.nextCursor };
};

describe('list pages (T-0812)', () => {
  it('pages actors in the same order as the whole list', async () => {
    const t = await setupTable();
    for (const name of NAMES) {
      await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/actors`, { type: 'npc', name });
    }
    const whole = await actorsOf(t, t.gm.client)('');
    expect(whole.nextCursor).toBeNull();
    expect(whole.list).toHaveLength(NAMES.length);
    for (const limit of [1, 3, 4, 100]) {
      const { all, sizes } = await walk(actorsOf(t, t.gm.client), limit);
      expect(all, `limit ${String(limit)}`).toEqual(whole.list);
      expect(sizes.slice(0, -1).every((size) => size === limit)).toBe(true);
    }
  });

  it('fills each page with what the caller may see', async () => {
    const t = await setupTable();
    // The GM's hidden NPCs sit between bob's characters in name order.
    for (let i = 0; i < 6; i += 1) {
      await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/actors`, {
        type: 'npc',
        name: `npc ${String(i)}`,
      });
      await t.call(t.bob.client, 'POST', `/tables/${t.table.id}/actors`, {
        type: 'character',
        name: `npc ${String(i)} hero`,
      });
    }
    const { all, sizes } = await walk(actorsOf(t, t.bob.client), 2);
    expect(all).toEqual([0, 1, 2, 3, 4, 5].map((i) => `npc ${String(i)} hero`));
    expect(sizes).toEqual([2, 2, 2]);
  });

  it('pages library items and journal entries, and filters still apply', async () => {
    const t = await setupTable();
    for (const name of ['Axe', 'Bow', 'Club', 'Dagger', 'Epee']) {
      await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/items`, { type: 'weapon', name });
      await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/journal`, {
        title: `${name} notes`,
        hidden: false,
      });
    }
    const items = await walk(async (query) => {
      const res = await t.call(t.bob.client, 'GET', `/tables/${t.table.id}/items${query}&search=e`);
      const body = res.json<{ items: ItemView[]; nextCursor: string | null }>();
      return { list: body.items.map((i) => i.name), nextCursor: body.nextCursor };
    }, 2);
    expect(items.all).toEqual(['Axe', 'Dagger', 'Epee']);
    const journal = await walk(async (query) => {
      const res = await t.call(t.bob.client, 'GET', `/tables/${t.table.id}/journal${query}`);
      const body = res.json<{ entries: JournalEntryView[]; nextCursor: string | null }>();
      return { list: body.entries.map((e) => e.title), nextCursor: body.nextCursor };
    }, 2);
    expect(journal.all).toEqual(['Axe', 'Bow', 'Club', 'Dagger', 'Epee'].map((n) => `${n} notes`));
    expect(journal.sizes).toEqual([2, 2, 1]);
  });

  it('refuses bad limits and cursors', async () => {
    const t = await setupTable();
    const url = `/tables/${t.table.id}/actors`;
    for (const query of ['?limit=0', '?limit=101', '?limit=x', '?limit=2&cursor=nope']) {
      expect((await t.call(t.gm.client, 'GET', `${url}${query}`)).statusCode, query).toBe(400);
    }
    const forged = Buffer.from(JSON.stringify({ a: 1 })).toString('base64url');
    const res = await t.call(t.gm.client, 'GET', `${url}?limit=2&cursor=${forged}`);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('invalid_cursor');
  });
});
