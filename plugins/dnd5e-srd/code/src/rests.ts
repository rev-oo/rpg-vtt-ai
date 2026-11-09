// Death saving throws and rests (SRD 5.2): handlers that roll and then step the actor's
// counters, which formula recipes cannot do. Text is English: server code has no lang files.
import type { HandlerInput, HandlerRoll } from '@vtt/sdk';

import { hitDieOf } from './tables.js';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at a dot path of an actor's data. */
function at(data: Readonly<Record<string, unknown>>, path: string): unknown {
  let value: unknown = data;
  for (const key of path.split('.')) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/** A number at a dot path, or `fallback` when there is none. */
export const numberAt = (
  data: Readonly<Record<string, unknown>>,
  path: string,
  fallback = 0,
): number => {
  const value = at(data, path);
  return typeof value === 'number' ? value : fallback;
};
const textAt = (data: Readonly<Record<string, unknown>>, path: string): string => {
  const value = at(data, path);
  return typeof value === 'string' ? value : '';
};

/** The d20 a saving throw rolls, with the actor's Advantage or Disadvantage (`saveEdge`). */
const SAVE_D20 = '(@derived.saveEdge == 0 ? 1d20 : @derived.saveEdge > 0 ? 2d20kh1 : 2d20kl1)';

/** The d20 the roll kept: the first die term's active result. */
export function naturalOf(roll: HandlerRoll): number {
  const kept = roll.dice[0]?.results.find((result) => result.active);
  return kept?.value ?? 0;
}

/**
 * A Death Saving Throw: 10 or more succeeds, a natural 1 counts as two failures, a natural 20
 * brings the character back with 1 Hit Point. Three successes stabilize, three failures kill.
 */
export async function deathSave({ ctx, actor }: HandlerInput): Promise<void> {
  if (numberAt(actor.data, 'hp.value') > 0) ctx.fail(`${actor.name} is not dying.`);
  const roll = await ctx.roll(`${SAVE_D20} - @derived.d20Penalty`);
  const natural = naturalOf(roll);
  const successes = numberAt(actor.data, 'deathSaves.successes');
  const failures = numberAt(actor.data, 'deathSaves.failures');
  let text: string;
  if (natural === 20) {
    await ctx.actors.adjust(actor.id, 'hp.value', 1);
    await ctx.actors.adjust(actor.id, 'deathSaves.successes', -successes);
    await ctx.actors.adjust(actor.id, 'deathSaves.failures', -failures);
    text = `${actor.name} rolls a natural 20 and regains 1 Hit Point!`;
  } else if (roll.total >= 10) {
    const now = await ctx.actors.adjust(actor.id, 'deathSaves.successes', 1);
    text =
      now >= 3
        ? `${actor.name} is stable.`
        : `${actor.name}: Death Saving Throw success (${String(now)}/3).`;
  } else {
    const now = await ctx.actors.adjust(actor.id, 'deathSaves.failures', natural === 1 ? 2 : 1);
    text =
      now >= 3
        ? `${actor.name} dies.`
        : `${actor.name}: Death Saving Throw failure (${String(now)}/3).`;
  }
  await ctx.chat.post({ text, rolls: [roll] });
}

/** Spends one Hit Die: roll it plus the Constitution modifier, and regain that many Hit Points. */
export async function spendHitDie({ ctx, actor }: HandlerInput): Promise<void> {
  const level = numberAt(actor.data, 'level', 1);
  const used = numberAt(actor.data, 'hitDiceUsed');
  if (used >= level) ctx.fail(`${actor.name} has no Hit Dice left.`);
  const die = hitDieOf(textAt(actor.data, 'class'));
  const roll = await ctx.roll(`1d${String(die)} + @derived.conMod`);
  const value = numberAt(actor.data, 'hp.value');
  const max = numberAt(actor.data, 'hp.max', 1);
  const healed = Math.max(0, Math.min(Math.max(1, roll.total), max - value));
  if (healed > 0) await ctx.actors.adjust(actor.id, 'hp.value', healed);
  await ctx.actors.adjust(actor.id, 'hitDiceUsed', 1);
  await ctx.chat.post({
    text: `${actor.name} spends a Hit Die (d${String(die)}) and regains ${String(healed)} Hit Points.`,
    rolls: [roll],
  });
}

/**
 * A Long Rest: all Hit Points, all spent Hit Dice and spell slots back, temporary Hit Points
 * gone, Exhaustion down by 1, death saves cleared. Feature uses live on items, which server
 * code cannot change, so they are left to the player.
 */
export async function longRest({ ctx, actor }: HandlerInput): Promise<void> {
  const data = actor.data;
  const steps: [string, number][] = [
    ['hp.value', numberAt(data, 'hp.max', 1) - numberAt(data, 'hp.value')],
    ['hp.temp', -numberAt(data, 'hp.temp')],
    ['hitDiceUsed', -numberAt(data, 'hitDiceUsed')],
    ['deathSaves.successes', -numberAt(data, 'deathSaves.successes')],
    ['deathSaves.failures', -numberAt(data, 'deathSaves.failures')],
    ['exhaustion', numberAt(data, 'exhaustion') > 0 ? -1 : 0],
  ];
  for (let level = 1; level <= 9; level++) {
    steps.push([`slotsUsed.l${String(level)}`, -numberAt(data, `slotsUsed.l${String(level)}`)]);
  }
  for (const [path, delta] of steps) {
    if (delta !== 0) await ctx.actors.adjust(actor.id, path, delta);
  }
  await ctx.chat.post({
    text: `${actor.name} finishes a Long Rest: Hit Points, Hit Dice and spell slots are restored.`,
  });
}
