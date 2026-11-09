import { childrenOf, type Expression } from './ast.js';
import { FormulaError } from './errors.js';
import { parse } from './parser.js';

/** What a dice expression stored as text may hold besides numbers and dice. */
const ARITHMETIC: ReadonlySet<string> = new Set(['+', '-', '*', '/', '%']);

function allowed(node: Expression): boolean {
  switch (node.kind) {
    case 'number':
    case 'dice':
      return true;
    case 'unary':
      return node.operator === '-';
    case 'binary':
      return ARITHMETIC.has(node.operator);
    default:
      return false;
  }
}

/**
 * Parses a dice expression kept in a text field, such as `2d6 + 1d4 + 3` (T-1607): numbers,
 * dice and arithmetic, with no references, functions or text, so what a player types cannot
 * read anything. Blank text is no dice and gives `null`. Throws a `FormulaError` otherwise.
 */
export function parseDice(source: string): Expression | null {
  if (source.trim() === '') return null;
  const tree = parse(source);
  const pending = [tree];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (!allowed(node)) {
      throw new FormulaError(
        'not_dice',
        'Only numbers, dice and + - * / can be used here, as in 2d6 + 3',
        node.span,
        source,
      );
    }
    pending.push(...childrenOf(node));
  }
  return tree;
}

/** Whether `source` is a dice expression {@link parseDice} accepts; blank text is. */
export function isDiceText(source: string): boolean {
  try {
    parseDice(source);
    return true;
  } catch (error) {
    if (error instanceof FormulaError) return false;
    throw error;
  }
}
