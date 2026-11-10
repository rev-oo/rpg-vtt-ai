import { describe, expect, it } from 'vitest';

import type { HandlerItem } from '@vtt/sdk';
import { fakeHandler, loadTestSystem, type FakeHandlerOptions } from '@vtt/sdk/testing';

import shared from '../shared.js';
import { deathSave, longRest, spendHitDie, spendSlot } from '../src/rests.js';

// The handlers run against the SDK's fake `ctx` (T-1613): it keeps the counters, within their
// bounds, and records what each handler rolled, stepped and posted.

/** Counters a 5e character never takes below 0. */
const FLOORED = [
  'hp.value',
  'hp.temp',
  'hitDiceUsed',
  'exhaustion',
  'deathSaves.successes',
  'deathSaves.failures',
  'slotsUsed.l1',
  'slotsUsed.l2',
];

/** Mira, with `data`, and counters bounded at 0 and the given maximums. */
function fake(
  data: Record<string, unknown>,
  { maximum = {}, ...options }: FakeHandlerOptions & { maximum?: Record<string, number> } = {},
) {
  const bounds = Object.fromEntries(
    FLOORED.map((path) => [path, { minimum: 0, maximum: maximum[path] ?? Infinity }]),
  );
  const handler = fakeHandler({ actor: { id: 'a1', name: 'Mira', data }, bounds, ...options });
  return {
    ...handler,
    /** The actor's counter steps, as [path, delta]. */
    adjusted: () =>
      handler.steps.filter((step) => step.kind === 'actor').map((step) => [step.path, step.delta]),
    /** The items' counter steps, as [id, path, delta]. */
    itemsAdjusted: () =>
      handler.steps
        .filter((step) => step.kind === 'item')
        .map((step) => [step.id, step.path, step.delta]),
  };
}

/** A feature item with `used` uses spent. */
const feature = (id: string, recharge: string, used: number): HandlerItem => ({
  id,
  name: id,
  type: 'feature',
  data: { recharge, uses: { used, max: 3 } },
  derived: {},
});

describe('death saving throws', () => {
  it('counts a success at 10 or more and a failure below', async () => {
    const up = fake({ hp: { value: 0 } }, { rolls: [{ total: 12 }] });
    await deathSave(up.input);
    expect(up.adjusted()).toEqual([['deathSaves.successes', 1]]);
    // Posted by lang key (T-1611), so each viewer reads it in their language.
    expect(up.posts[0]).toMatchObject({
      key: 'chat.deathSave.success',
      params: { name: 'Mira', count: 1 },
    });

    const down = fake({ hp: { value: 0 } }, { rolls: [{ total: 7 }] });
    await deathSave(down.input);
    expect(down.adjusted()).toEqual([['deathSaves.failures', 1]]);
  });

  it('counts a natural 1 as two failures, and brings the character back on a 20', async () => {
    const one = fake({ hp: { value: 0 } }, { rolls: [{ total: -1, natural: 1 }] });
    await deathSave(one.input);
    expect(one.adjusted()).toEqual([['deathSaves.failures', 2]]);

    const twenty = fake(
      { hp: { value: 0 }, deathSaves: { successes: 1, failures: 2 } },
      { rolls: [{ total: 20, natural: 20 }] },
    );
    await deathSave(twenty.input);
    expect(twenty.adjusted()).toEqual([
      ['hp.value', 1],
      ['deathSaves.successes', -1],
      ['deathSaves.failures', -2],
    ]);
    expect(twenty.posts[0]).toMatchObject({
      key: 'chat.deathSave.revived',
      params: { name: 'Mira' },
    });
  });

  it('refuses a character who is not dying', async () => {
    await expect(deathSave(fake({ hp: { value: 3 } }).input)).rejects.toThrow('Mira is not dying.');
  });
});

describe('rests', () => {
  it('spends a Hit Die of the class and heals up to the maximum', async () => {
    const rest = fake(
      { class: 'class.wizard', level: 3, hitDiceUsed: 1, hp: { value: 4, max: 8 } },
      { rolls: [{ total: 9 }], maximum: { 'hp.value': 8 }, derived: { hitDie: 6 } },
    );
    await spendHitDie(rest.input);
    expect(rest.rolled).toEqual(['1d6 + @derived.conMod']);
    // The counter's maximum (`@hp.max`) stops the healing.
    expect(rest.adjusted()).toEqual([
      ['hp.value', 9],
      ['hitDiceUsed', 1],
    ]);
    expect(rest.posts[0]).toMatchObject({
      key: 'chat.hitDie',
      params: { name: 'Mira', die: 6, hp: 4 },
    });
  });

  it('has no Hit Die to spend once all are spent', async () => {
    const rest = fake({ class: 'class.fighter', level: 2, hitDiceUsed: 2 });
    await expect(spendHitDie(rest.input)).rejects.toThrow('Mira has no Hit Dice left.');
  });

  it('restores everything a Long Rest restores', async () => {
    const rest = fake(
      {
        hp: { value: 3, max: 20, temp: 4 },
        hitDiceUsed: 2,
        exhaustion: 2,
        deathSaves: { successes: 0, failures: 1 },
        slotsUsed: { l1: 3, l2: 1 },
      },
      {
        items: [
          feature('f1', 'recharge.long', 2),
          feature('f2', 'recharge.short', 1),
          feature('f3', 'recharge.none', 1),
          feature('f4', 'recharge.long', 0),
        ],
      },
    );
    await longRest(rest.input);
    expect(rest.adjusted()).toEqual([
      ['hp.value', 17],
      ['hp.temp', -4],
      ['hitDiceUsed', -2],
      ['deathSaves.failures', -1],
      ['exhaustion', -1],
      ['slotsUsed.l1', -3],
      ['slotsUsed.l2', -1],
    ]);
    // Features that recharge get their uses back; the others keep theirs.
    expect(rest.itemsAdjusted()).toEqual([
      ['f1', 'uses.used', -2],
      ['f2', 'uses.used', -1],
    ]);
    expect(rest.posts).toEqual([{ key: 'chat.longRest', params: { name: 'Mira' } }]);
  });
});

describe('spell slots (T-1610)', () => {
  it('spends a slot of the level the spell was cast at', async () => {
    const cast = fake(
      { slotsUsed: { l2: 1 } },
      { maximum: { 'slotsUsed.l2': 3 }, options: { slot: 2 } },
    );
    await spendSlot(cast.input);
    expect(cast.adjusted()).toEqual([['slotsUsed.l2', 1]]);
    expect(cast.counter('slotsUsed.l2')).toBe(2);
    expect(cast.posts).toEqual([]);
  });

  it('spends nothing for a cantrip', async () => {
    const cantrip = fake({}, { options: { slot: 0 } });
    await spendSlot(cantrip.input);
    expect(cantrip.adjusted()).toEqual([]);
  });

  it('says so when no slot of that level is left', async () => {
    const spent = fake(
      { slotsUsed: { l1: 2 } },
      { maximum: { 'slotsUsed.l1': 2 }, options: { slot: 1 } },
    );
    await expect(spendSlot(spent.input)).rejects.toThrow('Mira has no level 1 spell slots left.');
  });
});

describe("with the system's formulas (T-1613)", () => {
  // The fake rolls the formulas for real, so a formula the rules cannot work out fails here.
  const system = loadTestSystem('..', { functions: shared.functions });

  it('rolls a death save with the Exhaustion penalty', async () => {
    const save = fake({ hp: { value: 0 }, exhaustion: 2 }, { system: await system, dice: [13] });
    await deathSave(save.input);
    expect(save.posts[0]?.rolls?.[0]).toMatchObject({ resolved: '1d20 - 4', total: 9 });
    expect(save.adjusted()).toEqual([['deathSaves.failures', 1]]);
  });

  it('spends a Hit Die of the class with the Constitution modifier', async () => {
    const data = { class: 'class.fighter', level: 3, con: 14, hp: { value: 10, max: 28 } };
    const rest = fake(data, { system: await system, derived: { hitDie: 10 }, dice: [7] });
    await spendHitDie(rest.input);
    expect(rest.texts()).toEqual(['Mira spends a Hit Die (d10) and regains 9 Hit Points.']);
    expect(rest.texts('pt-BR')).toEqual([
      'Mira gasta um Dado de Vida (d10) e recupera 9 Pontos de Vida.',
    ]);
  });
});
