import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { DiceRoll, FormulaFunction, Rng, Value } from '@vtt/formula';
import { createRules, langText, type Rules } from '@vtt/plugin-engine';
import { validatePlugin, type PluginDefinition } from '@vtt/plugin-schema';

import type {
  HandlerActor,
  HandlerInput,
  HandlerItem,
  HandlerPost,
  HandlerRoll,
  PostedRoll,
  ServerContext,
} from '../index.js';

// `@vtt/sdk/testing` (T-1613): tools for testing a system's shared and server code in Node,
// without a server. `fakeHandler` gives a handler a `ctx` that records what it asked for, and
// `loadTestSystem` loads a plugin's JSON files to work out derived values and roll recipes.

export type { Rules } from '@vtt/plugin-engine';

/** Dice that land on the given faces, in order; the rolls throw once the faces run out. */
export function scriptedDice(...faces: number[]): Rng {
  const queue = [...faces];
  return {
    nextInt: (sides) => {
      const face = queue.shift();
      if (face === undefined) throw new Error(`No scripted face is left for a d${String(sides)}`);
      if (!Number.isInteger(face) || face < 1 || face > sides)
        throw new Error(`A d${String(sides)} cannot land on ${String(face)}`);
      return face - 1;
    },
  };
}

/** What a fake `ctx.roll` gives: a total, and the d20 it shows when `natural` is set. */
export interface FakeRoll {
  total: number;
  /** The face of a d20 in the roll, for code that reads `dice` (a natural 20…). */
  natural?: number;
  dice?: DiceRoll[];
}

/** A counter's bounds in a fake: the server takes them from the schema and its formulas. */
export interface FakeBounds {
  minimum?: number;
  maximum?: number;
}

export interface FakeHandlerOptions {
  /** The rolling actor; its `data` is where counters start. */
  actor?: Partial<HandlerActor>;
  /** Other actors `ctx.actors.get` finds, besides the rolling one. */
  actors?: readonly HandlerActor[];
  derived?: Readonly<Record<string, Value>>;
  totals?: Readonly<Record<string, Value>>;
  /** The items the actor holds; `ctx.items.adjust` steps their counters. */
  items?: readonly HandlerItem[];
  /** The item the roll is made with: one of `items`, by id, or an item of its own. */
  item?: string | HandlerItem;
  args?: Readonly<Record<string, Value>>;
  options?: Readonly<Record<string, string | number>>;
  /** For a `then` handler: the roll the recipe posted. */
  result?: PostedRoll;
  /**
   * What `ctx.roll` gives: totals in order (numbers or {@link FakeRoll}s), or a function of the
   * formula. Without them, and without `system`, every roll totals 10.
   */
  rolls?: readonly (number | FakeRoll)[] | ((formula: string) => number | FakeRoll);
  /**
   * Rolls formulas for real against the actor with a {@link loadTestSystem} system, landing
   * the dice on `dice`; `rolls` then goes unused.
   */
  system?: TestSystem;
  /** The faces the dice land on, in order, when rolling with `system`. */
  dice?: readonly number[];
  /** Counter bounds by path, such as `{ 'hp.value': { minimum: 0, maximum: 27 } }`. */
  bounds?: Readonly<Record<string, FakeBounds>>;
}

/** A counter step the code asked for, and where the counter ended. */
export interface FakeStep {
  kind: 'actor' | 'item';
  id: string;
  path: string;
  delta: number;
  value: number;
}

export interface FakeHandler {
  /** What to call the handler with. */
  input: HandlerInput;
  ctx: ServerContext;
  /** Messages posted with `ctx.chat.post`. */
  posts: HandlerPost[];
  /** Formulas rolled with `ctx.roll`, in order. */
  rolled: string[];
  /** Counter steps, from `ctx.actors.adjust` and `ctx.items.adjust`. */
  steps: FakeStep[];
  /** Fields set with `ctx.actors.set`. */
  sets: { id: string; path: string; value: string | number | boolean }[];
  logs: { message: string; data?: Readonly<Record<string, unknown>> }[];
  /** A counter's value now, after the code's steps: the actor's, or an item's or actor's by id. */
  counter: (path: string, id?: string) => number;
  /**
   * The posts' texts as a viewer reads them in `locale` (T-1611): a post by lang key is filled
   * in from the `system`'s lang files, English where the locale has no text; without a system
   * it shows its key. Posts with only rolls give `''`.
   */
  texts: (locale?: string) => string[];
}

/** Thrown by a fake `ctx.fail`, with the message the caller would see. */
export class HandlerFailure extends Error {
  override name = 'HandlerFailure';
}

/** The value at a dot path of plain data. */
function valueAt(data: unknown, dotPath: string): unknown {
  let value = data;
  for (const key of dotPath.split('.')) {
    value =
      typeof value === 'object' && value !== null && Object.hasOwn(value, key)
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  return value;
}

const numberAt = (data: unknown, dotPath: string): number => {
  const value = valueAt(data, dotPath);
  return typeof value === 'number' ? value : 0;
};

const d20 = (face: number): DiceRoll => ({
  formula: '1d20',
  count: 1,
  die: 'd20',
  total: face,
  results: [{ value: face, active: true }],
});

/**
 * A handler's input with a fake `ctx` (T-1613). The fake keeps counters from the actor's and
 * items' data, within `bounds`, and records every roll, post, step, set and log. `ctx.fail`
 * throws a {@link HandlerFailure}. It checks no rights: test those on a server.
 */
export function fakeHandler(options: FakeHandlerOptions = {}): FakeHandler {
  const actor: HandlerActor = {
    id: 'actor-1',
    name: 'Tester',
    type: 'character',
    data: {},
    ...options.actor,
  };
  const items = options.items ?? [];
  const item =
    typeof options.item === 'string'
      ? items.find((each) => each.id === options.item)
      : options.item;
  if (typeof options.item === 'string' && !item)
    throw new Error(`fakeHandler: no item "${options.item}" among items`);
  const others = options.actors ?? [];
  const bounds = options.bounds ?? {};
  const rng = scriptedDice(...(options.dice ?? []));
  const script = options.rolls;
  const scripted: (number | FakeRoll)[] =
    script === undefined || typeof script === 'function' ? [] : [...script];

  const posts: HandlerPost[] = [];
  const rolled: string[] = [];
  const steps: FakeStep[] = [];
  const sets: FakeHandler['sets'] = [];
  const logs: FakeHandler['logs'] = [];
  const counters = new Map<string, number>();

  const dataOf = (kind: 'actor' | 'item', id: string): unknown => {
    if (kind === 'actor') {
      if (id === actor.id) return actor.data;
      return others.find((each) => each.id === id)?.data;
    }
    return [...items, ...(item ? [item] : [])].find((each) => each.id === id)?.data;
  };
  const counter = (kind: 'actor' | 'item', id: string, counterPath: string) =>
    counters.get(`${kind}:${id}:${counterPath}`) ?? numberAt(dataOf(kind, id), counterPath);
  const step = (kind: 'actor' | 'item', id: string, counterPath: string, delta: number) => {
    if (dataOf(kind, id) === undefined)
      return Promise.reject(new Error(`The fake has no ${kind} "${id}"`));
    const { minimum = -Infinity, maximum = Infinity } = bounds[counterPath] ?? {};
    const value = Math.min(maximum, Math.max(minimum, counter(kind, id, counterPath) + delta));
    counters.set(`${kind}:${id}:${counterPath}`, value);
    steps.push({ kind, id, path: counterPath, delta, value });
    return Promise.resolve(value);
  };

  const rollWith = (formula: string): HandlerRoll => {
    const ref = rolled.length;
    if (options.system) {
      const result = options.system.rules.rollFormula(formula, {
        type: actor.type,
        data: actor.data,
        items: items.map(({ type, data }) => ({ type, data })),
        args: options.args ?? {},
        rng,
      });
      return { ...result, ref };
    }
    const next = typeof script === 'function' ? script(formula) : (scripted.shift() ?? 10);
    const roll = typeof next === 'number' ? { total: next } : next;
    const dice = roll.dice ?? (roll.natural === undefined ? [] : [d20(roll.natural)]);
    return { ref, expression: formula, resolved: formula, total: roll.total, dice };
  };

  const ctx: ServerContext = {
    roll: (formula) => {
      rolled.push(formula);
      try {
        return Promise.resolve(rollWith(formula));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    chat: {
      post: (message) => {
        posts.push(message);
        return Promise.resolve();
      },
    },
    actors: {
      get: (id) =>
        Promise.resolve(id === actor.id ? actor : (others.find((each) => each.id === id) ?? null)),
      adjust: (id, counterPath, delta) => step('actor', id, counterPath, delta),
      set: (id, fieldPath, value) => {
        sets.push({ id, path: fieldPath, value });
        return Promise.resolve();
      },
    },
    items: {
      adjust: (id, counterPath, delta) => step('item', id, counterPath, delta),
    },
    log: (message, data) => {
      logs.push(data === undefined ? { message } : { message, data });
    },
    fail: (message) => {
      throw new HandlerFailure(message);
    },
  };

  const input: HandlerInput = {
    ctx,
    actor,
    derived: options.derived ?? {},
    totals: options.totals ?? {},
    items,
    args: options.args ?? {},
    options: options.options ?? {},
    ...(item && { item }),
    ...(options.result && { result: options.result }),
  };
  return {
    input,
    ctx,
    posts,
    rolled,
    steps,
    sets,
    logs,
    counter: (counterPath, id = actor.id) =>
      counter(dataOf('item', id) === undefined ? 'actor' : 'item', id, counterPath),
    texts: (locale = 'en') => {
      const langs = options.system?.plugin.lang ?? {};
      const translate = (text: string) => {
        for (const lang of [langs[locale], langs.en]) {
          if (lang && Object.hasOwn(lang, text)) return lang[text] ?? text;
        }
        return text;
      };
      return posts.map((post) =>
        post.key === undefined ? (post.text ?? '') : langText(translate, post.key, post.params),
      );
    },
  };
}

/** A system plugin's data files, loaded for tests: what the server would work out from them. */
export interface TestSystem {
  plugin: PluginDefinition;
  /** The plugin's rules for one table: defaults, derived values, item totals and rolls. */
  rules: Rules;
}

export interface LoadTestSystemOptions {
  /** The functions of `code/shared`, for formulas that call them. */
  functions?: Readonly<Record<string, FormulaFunction>>;
  /** The table's setting values; the others take their defaults. */
  settings?: Readonly<Record<string, unknown>>;
}

/** Files under `code/` that are not data: the validator only needs to know `code/` exists. */
const SKIPPED = /(^|\/)(node_modules|\.[^/]*)(\/|$)/;

async function listFiles(root: string, dir = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const file = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (SKIPPED.test(file) || file.endsWith('.vttplugin')) continue;
    if (entry.isDirectory()) found.push(...(await listFiles(root, file)));
    else found.push(file);
  }
  return found;
}

/**
 * Loads a system plugin's folder as the server would, without its code (T-1613): it validates
 * the files and throws with the issues if any is an error. `folder` is a path, relative to
 * where the tests run (a plugin's `code/` package runs them from there, so `'..'`).
 */
export async function loadTestSystem(
  folder: string,
  { functions = {}, settings }: LoadTestSystemOptions = {},
): Promise<TestSystem> {
  const root = path.resolve(folder);
  const files = new Map<string, string>();
  for (const file of await listFiles(root)) {
    // Code is compiled by `pack`; the validator only checks that `code/` is there.
    files.set(file, file.startsWith('code/') ? '' : await readFile(path.join(root, file), 'utf8'));
  }
  const { issues, plugin } = validatePlugin(files);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (!plugin || errors.length > 0) {
    const listed = errors.map((issue) => `${issue.code} in ${issue.file}`).join(', ');
    throw new Error(`${root} is not a valid plugin: ${listed || 'no plugin.json'}`);
  }
  return { plugin, rules: createRules(plugin, { functions, ...(settings && { settings }) }) };
}
