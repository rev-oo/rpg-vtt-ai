import { describe, expect, it } from 'vitest';

import type { Handler } from '../../src/index.js';
import {
  fakeHandler,
  HandlerFailure,
  loadTestSystem,
  scriptedDice,
} from '../../src/testing/index.js';

// T-1613: `@vtt/sdk/testing`, the kit plugins test their shared and server code with.

/** tiny-d20, from where the SDK's tests run (`packages/sdk`). */
const TINY_D20 = '../../plugins/tiny-d20';

const heal: Handler = async ({ ctx, actor, args }) => {
  const roll = await ctx.roll('1d8 + 2');
  const hp = await ctx.actors.adjust(actor.id, 'hp.value', roll.total);
  if (args.loud === true) ctx.log('healed', { hp });
  await ctx.chat.post({ text: `${actor.name} heals to ${String(hp)}`, rolls: [roll] });
};

describe('fakeHandler (T-1613)', () => {
  it('scripts rolls and keeps counters within their bounds, recording each call', async () => {
    const fake = fakeHandler({
      actor: { name: 'Mira', data: { hp: { value: 5 } } },
      rolls: [9],
      bounds: { 'hp.value': { minimum: 0, maximum: 12 } },
      args: { loud: true },
    });
    await heal(fake.input);
    expect(fake.rolled).toEqual(['1d8 + 2']);
    expect(fake.counter('hp.value')).toBe(12);
    expect(fake.steps).toEqual([
      { kind: 'actor', id: 'actor-1', path: 'hp.value', delta: 9, value: 12 },
    ]);
    expect(fake.posts.map((post) => post.text)).toEqual(['Mira heals to 12']);
    expect(fake.logs).toEqual([{ message: 'healed', data: { hp: 12 } }]);
  });

  it('gives natural d20s, steps items, sets fields and fails like the server', async () => {
    const gem = { id: 'gem', name: 'Ruby', type: 'gem', data: { used: 1 }, derived: {} };
    const fake = fakeHandler({
      items: [gem],
      item: 'gem',
      rolls: (formula) => (formula.startsWith('1d20') ? { total: 20, natural: 20 } : 3),
    });
    expect(fake.input.item).toBe(gem);
    const crit = await fake.ctx.roll('1d20 + 4');
    expect(crit.dice[0]?.results[0]?.value).toBe(20);
    expect((await fake.ctx.roll('1d4')).total).toBe(3);
    expect(await fake.ctx.items.adjust('gem', 'used', 2)).toBe(3);
    expect(fake.counter('used', 'gem')).toBe(3);
    await fake.ctx.actors.set('actor-1', 'title', 'Sir');
    expect(fake.sets).toEqual([{ id: 'actor-1', path: 'title', value: 'Sir' }]);
    await expect(fake.ctx.items.adjust('lost', 'used', 1)).rejects.toThrow('no item "lost"');
    expect(() => fake.ctx.fail('No charge left.')).toThrow(HandlerFailure);
    expect(await fake.ctx.actors.get('nobody')).toBeNull();
    // Without a script, every roll totals 10.
    expect((await fakeHandler().ctx.roll('1d6')).total).toBe(10);
  });

  it("rolls for real against a system's rules, with scripted dice", async () => {
    const system = await loadTestSystem(TINY_D20);
    const fake = fakeHandler({
      system,
      actor: { type: 'character', data: { str: 16 } },
      dice: [17],
    });
    const roll = await fake.ctx.roll('1d20 + @derived.strMod');
    expect(roll.total).toBe(20);
    expect(roll.resolved).toBe('1d20 + 3');
    await expect(fake.ctx.roll('1d20')).rejects.toThrow('No scripted face');
  });

  it('reads posts by lang key in a language, as viewers would (T-1611)', async () => {
    const fake = fakeHandler({ system: await loadTestSystem(TINY_D20) });
    await fake.ctx.chat.post({ key: 'type.character' });
    await fake.ctx.chat.post({ key: 'not.a.key', params: { n: 1 } });
    await fake.ctx.chat.post({ text: 'As written' });
    expect(fake.texts()).toEqual(['Character', 'not.a.key', 'As written']);
    expect(fake.texts('pt-BR')).toEqual(['Personagem', 'not.a.key', 'As written']);
    expect(fake.posts[0]).toEqual({ key: 'type.character' });
  });
});

describe('loadTestSystem (T-1613)', () => {
  it("works out a system's defaults, derived values and rolls from its files", async () => {
    const { plugin, rules } = await loadTestSystem(TINY_D20, { settings: { startingHp: 12 } });
    expect(plugin.manifest.id).toBe('tiny-d20');
    expect(rules.derived('actor', 'character', { str: 14, level: 5 })).toMatchObject({
      values: { strMod: 2, proficiency: 3, maxHp: 16 },
    });
    const attack = rules.roll('attack', {
      type: 'character',
      data: { str: 18 },
      rng: scriptedDice(11),
    });
    expect(attack.rolls[0]?.total).toBe(15);
  });

  it('refuses a folder that is not a valid plugin', async () => {
    await expect(loadTestSystem('test')).rejects.toThrow('is not a valid plugin');
  });

  it('checks scripted faces against the die', () => {
    expect(() => scriptedDice(7).nextInt(6)).toThrow('A d6 cannot land on 7');
  });
});
