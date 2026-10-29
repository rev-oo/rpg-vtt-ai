import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { documentName } from '@vtt/shared';
import { MAX_ACTOR_ITEMS, type ChatMessage, type ItemView } from '@vtt/shared/api';

import { createItem } from '../src/db/repositories/index.js';
import { items } from '../src/db/schema.js';

import { authHeaders, type Client, type TestApp } from './support/app.js';
import { openCollab } from './support/collab.js';
import { createActorAs, startWithSystems, systemsDir, tableWithPlayer } from './support/systems.js';

// T-1205 (FR-PLUGIN-15, ADR-063): item types contribute to their holder's formulas.

const SYSTEMS = ['tiny-d20'];

let dataDir: string;
let t: TestApp;
let gm: Client;

/** tiny-d20 with armour that adds to an AC derived value while equipped. */
async function withArmor(dir: string) {
  const plugin = path.join(dir, 'plugins/tiny-d20');
  await writeFile(
    path.join(plugin, 'types/items/armor.json'),
    JSON.stringify({
      label: 'Armor',
      sheet: 'armor',
      schema: {
        type: 'object',
        properties: {
          equipped: { type: 'boolean', default: false },
          acBonus: { type: 'integer', default: 2, minimum: 0, maximum: 10 },
          curse: { type: 'integer', default: 0, 'x-layer': 'secret' },
        },
      },
      contributes: { acBonus: { formula: '@equipped ? @acBonus : 0' } },
    }),
  );
  await writeFile(
    path.join(plugin, 'sheets/armor.json'),
    JSON.stringify({
      layout: {
        type: 'column',
        children: [
          { type: 'field', path: 'equipped', input: 'checkbox', label: 'Equipped' },
          { type: 'field', path: 'acBonus', input: 'number', label: 'AC bonus' },
        ],
      },
    }),
  );
  const file = path.join(plugin, 'types/actors/character.json');
  const character = JSON.parse(await readFile(file, 'utf8')) as {
    derived: Record<string, string>;
  };
  character.derived.ac = '10 + @derived.dexMod + @items.acBonus';
  await writeFile(file, JSON.stringify(character));
  // A roll made with armour (T-1207).
  const rollsFile = path.join(plugin, 'rolls.json');
  const rolls = JSON.parse(await readFile(rollsFile, 'utf8')) as Record<string, unknown>;
  rolls.brace = { formula: '1d20 + @item.acBonus', item: ['armor'] };
  rolls.peek = { formula: '1d20 + @item.curse', item: ['armor'] };
  await writeFile(rollsFile, JSON.stringify(rolls));
}

beforeEach(async () => {
  dataDir = await systemsDir(SYSTEMS);
  await withArmor(dataDir);
  // The default debounce: edits stay unsaved for the length of a test.
  ({ t, gm } = await startWithSystems(dataDir, SYSTEMS));
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function call(client: Client, method: 'POST' | 'DELETE', url: string, body?: object) {
  return t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: authHeaders(client),
    ...(body && { payload: body }),
  });
}

/** bob's character Ayla, holding a copy of the library's armour. */
async function armoured() {
  const { table, player: bob } = await tableWithPlayer(t, gm, 'tiny-d20', 'bob');
  const created = await call(gm, 'POST', `/tables/${table.id}/items`, {
    type: 'armor',
    name: 'Chain shirt',
  });
  expect(created.statusCode, created.body).toBe(201);
  const ayla = await createActorAs(t, bob.client, table.id, 'character', 'Ayla');
  const given = await call(bob.client, 'POST', `/actors/${ayla.id}/items`, {
    itemId: created.json<{ item: ItemView }>().item.id,
  });
  expect(given.statusCode, given.body).toBe(201);
  return { table, bob: bob.client, ayla, armor: given.json<{ item: ItemView }>().item };
}

describe('item contributions (T-1205, ADR-063)', () => {
  it("adds equipped armour to the holder's AC, live, before it is stored", async () => {
    const { table, bob, ayla, armor } = await armoured();
    const ac = async () => {
      const res = await call(bob, 'POST', `/tables/${table.id}/rolls`, {
        formula: '1d20 + @derived.ac',
        actorId: ayla.id,
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json<{ message: ChatMessage }>().message.rolls[0]?.resolved;
    };
    expect(await ac()).toBe('1d20 + 10');

    const doc = await (
      await openCollab(t.app, bob)
    ).open(documentName({ kind: 'item', id: armor.id, layer: 'main' }));
    expect(await doc.change((d) => d.getMap('data').set('equipped', true))).toBe(true);
    expect(await ac()).toBe('1d20 + 12');

    // Items in the trash count no more.
    expect((await call(bob, 'DELETE', `/items/${armor.id}`)).statusCode).toBe(204);
    expect(await ac()).toBe('1d20 + 10');
  });

  it(`refuses an actor more than ${String(MAX_ACTOR_ITEMS)} items`, async () => {
    const { table, bob, ayla, armor } = await armoured();
    const now = new Date();
    for (let i = 1; i < MAX_ACTOR_ITEMS; i++) {
      createItem(
        t.db,
        {
          tableId: table.id,
          actorId: ayla.id,
          type: 'armor',
          name: `Ring ${String(i)}`,
          dataVersion: table.systemVersion,
        },
        now,
      );
    }
    const library = await call(gm, 'POST', `/tables/${table.id}/items`, {
      type: 'armor',
      name: 'Plate',
    });
    const res = await call(bob, 'POST', `/actors/${ayla.id}/items`, {
      itemId: library.json<{ item: ItemView }>().item.id,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'too_many_items' } });

    // A deleted item makes room, until it is restored over the limit.
    expect((await call(bob, 'DELETE', `/items/${armor.id}`)).statusCode).toBe(204);
    expect(
      (
        await call(bob, 'POST', `/actors/${ayla.id}/items`, {
          itemId: library.json<{ item: ItemView }>().item.id,
        })
      ).statusCode,
    ).toBe(201);
    const restore = await call(bob, 'POST', `/items/${armor.id}/restore`);
    expect(restore.statusCode).toBe(422);
  });
});

describe('rolls made with an item (T-1207, ADR-063)', () => {
  it("reads the actor's item, and refuses items it does not hold", async () => {
    const { table, bob, ayla, armor } = await armoured();
    const roll = (recipe: object) =>
      call(bob, 'POST', `/tables/${table.id}/rolls`, { recipe, actorId: ayla.id });

    const braced = await roll({ name: 'brace', itemId: armor.id });
    expect(braced.statusCode, braced.body).toBe(201);
    expect(braced.json<{ message: ChatMessage }>().message.rolls[0]?.resolved).toBe('1d20 + 2');

    // Another of bob's actors holds this one.
    const brin = await createActorAs(t, bob, table.id, 'character', 'Brin');
    const library = await call(gm, 'POST', `/tables/${table.id}/items`, {
      type: 'armor',
      name: 'Hide',
    });
    const hide = await call(bob, 'POST', `/actors/${brin.id}/items`, {
      itemId: library.json<{ item: ItemView }>().item.id,
    });
    const elsewhere = await roll({
      name: 'brace',
      itemId: hide.json<{ item: ItemView }>().item.id,
    });
    expect(elsewhere.statusCode).toBe(422);
    expect(elsewhere.json()).toMatchObject({ error: { code: 'item_not_held' } });

    // A library item is held by nobody.
    const unheld = await roll({
      name: 'brace',
      itemId: library.json<{ item: ItemView }>().item.id,
    });
    expect(unheld.json()).toMatchObject({ error: { code: 'item_not_held' } });

    // Rolls never read an item's secret fields: the default stands in.
    t.db
      .update(items)
      .set({ system: { curse: 7 } })
      .where(eq(items.id, armor.id))
      .run();
    const peek = await roll({ name: 'peek', itemId: armor.id });
    expect(peek.json<{ message: ChatMessage }>().message.rolls[0]?.resolved).toBe('1d20 + 0');

    expect((await roll({ name: 'brace' })).json()).toMatchObject({
      error: { code: 'item_required' },
    });
    expect((await roll({ name: 'attack', itemId: armor.id })).json()).toMatchObject({
      error: { code: 'item_not_taken' },
    });
  });
});
