import { evaluate, isDiceText, type FormulaFunction, type Value } from '@vtt/formula';
import type { RollOption, RollShortcut } from '@vtt/plugin-schema';

import { EngineError } from './errors.js';

/** What the app sends for a roll option (T-1609): a choice's value, a whole number or dice. */
export type OptionValue = string | number;

/** The longest dice text an option takes. */
export const MAX_OPTION_DICE_LENGTH = 200;

/** A number option with its default and bounds worked out for one roll. */
export interface NumberBounds {
  default: number;
  minimum?: number;
  maximum?: number;
}

interface Context {
  /** What the option's formulas read: the entity, `@item`, `@args` and `@settings`. */
  scope: Readonly<Record<string, unknown>>;
  functions?: Readonly<Record<string, FormulaFunction>>;
}

function wholeNumber(
  source: number | string,
  { scope, functions = {} }: Context,
  what: string,
): number {
  const value: Value =
    typeof source === 'number' ? source : evaluate(source, { data: scope, functions });
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new EngineError('bad_option', `${what} is not a whole number`);
  }
  return value;
}

/** A number option's default and bounds, which may be formulas such as `@item.level`. */
export function numberBounds(
  name: string,
  option: Extract<RollOption, { type: 'number' }>,
  context: Context,
): NumberBounds {
  const what = (key: string) => `The ${key} of the option "${name}"`;
  return {
    default: wholeNumber(option.default, context, what('default')),
    ...(option.minimum !== undefined && {
      minimum: wholeNumber(option.minimum, context, what('minimum')),
    }),
    ...(option.maximum !== undefined && {
      maximum: wholeNumber(option.maximum, context, what('maximum')),
    }),
  };
}

/** An option's value when the app asks for nothing. */
function defaultOf(name: string, option: RollOption, context: Context): OptionValue {
  switch (option.type) {
    case 'choice':
      return option.default ?? option.choices[0]?.value ?? '';
    case 'number':
      return numberBounds(name, option, context).default;
    case 'dice':
      return option.default ?? '';
  }
}

/** Every option at its default. */
export function optionDefaults(
  options: Readonly<Record<string, RollOption>>,
  context: Context,
): Record<string, OptionValue> {
  return Object.fromEntries(
    Object.entries(options).map(([name, option]) => [name, defaultOf(name, option, context)]),
  );
}

/**
 * The options a shortcut key picks (T-1609): the choice that names the key, and the other
 * options at their defaults. `null` when no choice uses the key.
 */
export function shortcutOptions(
  options: Readonly<Record<string, RollOption>>,
  key: RollShortcut,
  context: Context,
): Record<string, OptionValue> | null {
  for (const [name, option] of Object.entries(options)) {
    if (option.type !== 'choice') continue;
    const choice = option.choices.find((candidate) => candidate.key === key);
    if (choice) return { ...optionDefaults(options, context), [name]: choice.value };
  }
  return null;
}

function checked(name: string, option: RollOption, value: OptionValue, context: Context) {
  const refuse = (why: string): never => {
    throw new EngineError('bad_option', `The option "${name}" ${why}`);
  };
  switch (option.type) {
    case 'choice':
      if (!option.choices.some((choice) => choice.value === value)) refuse('has no such choice');
      return value;
    case 'number': {
      if (typeof value !== 'number' || !Number.isInteger(value))
        return refuse('takes a whole number');
      const { minimum, maximum } = numberBounds(name, option, context);
      if (minimum !== undefined && value < minimum) refuse(`must be at least ${String(minimum)}`);
      if (maximum !== undefined && value > maximum) refuse(`must be at most ${String(maximum)}`);
      return value;
    }
    case 'dice':
      if (typeof value !== 'string' || value.length > MAX_OPTION_DICE_LENGTH || !isDiceText(value))
        refuse('takes dice, such as 1d4');
      return value;
  }
}

/**
 * Checks what the app sent against the recipe's options (T-1609) and fills in the defaults of
 * those left out; what `@options` reads. Throws an `EngineError` (`bad_option`) otherwise.
 */
export function rollOptions(
  options: Readonly<Record<string, RollOption>>,
  given: Readonly<Record<string, OptionValue>>,
  context: Context,
): Record<string, OptionValue> {
  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(options, name))
      throw new EngineError('bad_option', `The roll has no option "${name}"`);
  }
  return Object.fromEntries(
    Object.entries(options).map(([name, option]) => {
      const value = Object.hasOwn(given, name) ? given[name] : undefined;
      return [
        name,
        value === undefined
          ? defaultOf(name, option, context)
          : checked(name, option, value, context),
      ];
    }),
  );
}
