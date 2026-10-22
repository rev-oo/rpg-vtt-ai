import type { FormulaFunction, Rng, Value } from '@vtt/formula';
import type { ActorType, ItemType, PluginDefinition } from '@vtt/plugin-schema';

import { withDefaults } from './data.js';
import { computeDerived, type DerivedValues } from './derived.js';
import { toCustomDice } from './dice.js';
import { EngineError } from './errors.js';
import { documentLayout, type DocumentLayout } from './layout.js';
import { rollRecipe, type RecipeResult } from './recipes.js';
import { settingValues } from './settings.js';

export type EntityKind = 'actor' | 'item';

export interface RulesOptions {
  /** The table's stored setting values (specs §8.12). */
  settings?: Readonly<Record<string, unknown>>;
  /** The plugin's `shared` functions (specs §8.10). */
  functions?: Readonly<Record<string, FormulaFunction>>;
}

export interface RollRequest {
  kind?: EntityKind;
  type: string;
  /** The entity's stored data; missing fields read as their defaults. */
  data: Readonly<Record<string, unknown>>;
  /** `@args.*`, from the roll button. */
  args?: Readonly<Record<string, Value>>;
  rng: Rng;
}

/** One system plugin applied to one table: what the core asks of a plugin's rules. */
export interface Rules {
  readonly settings: Readonly<Record<string, Value>>;
  /** The data a new entity of `type` starts with. */
  defaults(kind: EntityKind, type: string): Record<string, unknown>;
  /** `data` with defaults filled in, then its derived values. */
  derived(kind: EntityKind, type: string, data: Readonly<Record<string, unknown>>): DerivedValues;
  /** How an entity of `type` maps onto its live documents (specs §9.2). */
  layout(kind: EntityKind, type: string): DocumentLayout;
  /**
   * Rolls the recipe `name` (specs §8.7). Throws `EngineError` for an unknown recipe or a
   * `handler` one, which the server runs through plugin code instead, and `FormulaError`
   * when the formula cannot be rolled.
   */
  roll(name: string, request: RollRequest): RecipeResult;
}

export function createRules(
  plugin: PluginDefinition,
  { settings: stored, functions = {} }: RulesOptions = {},
): Rules {
  const settings = settingValues(plugin.settings, stored);
  const customDice = toCustomDice(plugin.dice);

  const typeOf = (kind: EntityKind, name: string): ActorType | ItemType => {
    const types: Record<string, ActorType | ItemType> =
      kind === 'actor' ? plugin.actorTypes : plugin.itemTypes;
    const type = Object.hasOwn(types, name) ? types[name] : undefined;
    if (!type) throw new EngineError('unknown_type', `There is no ${kind} type "${name}"`);
    return type;
  };
  const derivedOf = (type: ActorType | ItemType, data: Readonly<Record<string, unknown>>) =>
    computeDerived(type.derived ?? {}, data, { settings, functions });

  return {
    settings,
    defaults: (kind, name) => withDefaults(typeOf(kind, name).schema, {}),
    derived: (kind, name, data) => {
      const type = typeOf(kind, name);
      return derivedOf(type, withDefaults(type.schema, data));
    },
    layout: (kind, name) => documentLayout(typeOf(kind, name).schema),
    roll: (name, { kind = 'actor', type: typeName, data, args = {}, rng }) => {
      const recipe = Object.hasOwn(plugin.rolls, name) ? plugin.rolls[name] : undefined;
      if (!recipe) throw new EngineError('unknown_recipe', `There is no roll "${name}"`);
      if (!('formula' in recipe)) {
        throw new EngineError('handler_recipe', `The roll "${name}" runs plugin code`);
      }
      const type = typeOf(kind, typeName);
      const filled = withDefaults(type.schema, data);
      const scope = { ...filled, derived: derivedOf(type, filled).values, settings, args };
      return rollRecipe(name, recipe, { scope, rng, cards: plugin.cards, customDice, functions });
    },
  };
}
