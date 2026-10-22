import {
  childrenOf,
  compile,
  evaluate,
  FormulaError,
  type Expression,
  type Formula,
  type FormulaFunction,
  type Value,
} from '@vtt/formula';

/** Why a value could not be computed. */
export interface FormulaFailure {
  /** The `FormulaError` code, or `depends_on_failed` / `cycle`. */
  code: string;
  message: string;
}

export interface DerivedValues {
  values: Record<string, Value>;
  /** Derived values that failed, by name; the others are still computed. */
  errors: Record<string, FormulaFailure>;
}

export interface DerivedOptions {
  settings?: Readonly<Record<string, Value>>;
  functions?: Readonly<Record<string, FormulaFunction>>;
}

/** The derived values a formula reads (`@derived.<name>`). */
function derivedReads(ast: Expression): string[] {
  const names: string[] = [];
  const pending = [ast];
  for (let node = pending.pop(); node; node = pending.pop()) {
    pending.push(...childrenOf(node));
    const [first] = node.kind === 'reference' ? node.path : [];
    if (node.kind === 'reference' && node.name === 'derived' && first?.kind === 'field') {
      names.push(first.name);
    }
  }
  return names;
}

/**
 * Computes a type's derived values (specs §8.4) in pure mode, each after the ones it reads,
 * so they can build on each other. A value that does not parse or evaluate is reported in
 * `errors`, and so is each value that reads it; the validator rejects cycles, but a cycle
 * here fails its members instead of looping.
 */
export function computeDerived(
  definitions: Readonly<Record<string, string>>,
  data: Readonly<Record<string, unknown>>,
  { settings = {}, functions = {} }: DerivedOptions = {},
): DerivedValues {
  const values: Record<string, Value> = {};
  const errors: Record<string, FormulaFailure> = {};
  const formulas = new Map<string, Formula>();
  for (const [name, source] of Object.entries(definitions)) {
    try {
      formulas.set(name, compile(source));
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      errors[name] = { code: error.code, message: error.message };
    }
  }

  const state = new Map<string, 'running' | 'done'>();
  const compute = (name: string): void => {
    const formula = formulas.get(name);
    if (state.get(name) === 'done' || !formula) return;
    state.set(name, 'running');
    for (const read of derivedReads(formula.ast)) {
      if (state.get(read) === 'running') {
        errors[name] = { code: 'cycle', message: `${name} depends on itself through ${read}` };
      } else compute(read);
      const failed = errors[read];
      if (failed && !errors[name]) {
        errors[name] = { code: 'depends_on_failed', message: `${read}: ${failed.message}` };
      }
    }
    if (!errors[name]) {
      try {
        values[name] = evaluate(formula, {
          data: { ...data, derived: values, settings },
          functions,
        });
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        errors[name] = { code: error.code, message: error.message };
      }
    }
    state.set(name, 'done');
  };
  for (const name of formulas.keys()) compute(name);
  return { values, errors };
}
