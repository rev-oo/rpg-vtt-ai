import type { DiceModifier, DieComparator, Dice, Span } from './ast.js';
import { FormulaError } from './errors.js';

export const PUNCTUATION = [
  '<=',
  '>=',
  '==',
  '!=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '(',
  ')',
  '[',
  ']',
  ',',
  '.',
  '?',
  ':',
  '<',
  '>',
] as const;
export type Punctuation = (typeof PUNCTUATION)[number];

/** A dice term as the lexer reads it; the parser may still attach a `(count)` before it. */
export interface DiceToken {
  kind: 'dice';
  count: number | null;
  countRaw: string | null;
  die: Dice['die'];
  modifiers: DiceModifier[];
  span: Span;
}

export type Token =
  | { kind: 'number'; value: number; raw: string; span: Span }
  | { kind: 'string'; value: string; span: Span }
  | { kind: 'identifier'; name: string; span: Span }
  | { kind: 'reference'; name: string; span: Span }
  | { kind: 'punctuation'; value: Punctuation; span: Span }
  | DiceToken
  | { kind: 'end'; span: Span };

const WHITESPACE = /[ \t\r\n]+/y;
const NUMBER = /\d+(?:\.\d+)?/y;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/y;
// Custom dice are `d` plus uppercase letters and digits (`dF`), so the lowercase modifiers
// after them stay unambiguous: `4dFcs>=1`.
const DICE = /(\d+)?d(?:(\d+)|([A-Z][A-Z0-9]*))/y;
const KEEP_DROP = /(kh|kl|dh|dl)(\d+)?/y;
// `!=` after a die is a comparison, not an explosion: `2d6!=7`.
const EXPLODE = /!(?!=)/y;
const COMPARED = /(r|cs|cf)(<=|>=|<|>|=)?(\d+)/y;
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

function matchAt(pattern: RegExp, source: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(source);
}

const MODIFIER_KIND = { r: 'reroll', cs: 'success', cf: 'failure' } as const;
const KEEP_KIND = {
  kh: ['keep', 'highest'],
  kl: ['keep', 'lowest'],
  dh: ['drop', 'highest'],
  dl: ['drop', 'lowest'],
} as const;

/** Reads the modifiers after a die, starting at `at`; returns them and where they end. */
function readModifiers(source: string, at: number): { modifiers: DiceModifier[]; end: number } {
  const modifiers: DiceModifier[] = [];
  const seen = new Set<string>();
  let end = at;
  for (;;) {
    let modifier: DiceModifier;
    let key: string;
    let match: RegExpExecArray | null;
    if ((match = matchAt(KEEP_DROP, source, end))) {
      const code = match[1] as keyof typeof KEEP_KIND;
      const [kind, which] = KEEP_KIND[code];
      modifier = { kind, which, count: match[2] === undefined ? 1 : Number(match[2]) };
      key = 'keep/drop';
    } else if ((match = matchAt(EXPLODE, source, end))) {
      modifier = { kind: 'explode' };
      key = '!';
    } else if ((match = matchAt(COMPARED, source, end))) {
      const code = match[1] as keyof typeof MODIFIER_KIND;
      const comparator = (match[2] ?? '=') as DieComparator;
      modifier = { kind: MODIFIER_KIND[code], comparison: { comparator, value: Number(match[3]) } };
      key = code;
    } else {
      return { modifiers, end };
    }
    if (seen.has(key)) {
      const span = { start: end, end: end + match[0].length };
      throw new FormulaError(
        'duplicate_modifier',
        key === 'keep/drop'
          ? 'A die can have only one keep or drop modifier'
          : `The modifier "${key}" appears twice`,
        span,
        source,
      );
    }
    seen.add(key);
    modifiers.push(modifier);
    end += match[0].length;
  }
}

/** Splits a formula into tokens. The last token is always `end`. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    let match: RegExpExecArray | null;
    if ((match = matchAt(WHITESPACE, source, at))) {
      at += match[0].length;
      continue;
    }
    const start = at;
    const char = source.charAt(at);
    // `2d6` is a die, but not the end of a word (`x2d6`) or a field name (`@dice.d6`).
    const previous = source.charAt(at - 1);
    const mayBeDice = at === 0 || (previous !== '.' && !IDENTIFIER_CHAR.test(previous));

    if (mayBeDice && (match = matchAt(DICE, source, at))) {
      const [text, countRaw, sides, custom] = match;
      const { modifiers, end } = readModifiers(source, at + text.length);
      tokens.push({
        kind: 'dice',
        count: countRaw === undefined ? null : Number(countRaw),
        countRaw: countRaw ?? null,
        die:
          custom === undefined
            ? { kind: 'standard', sides: Number(sides) }
            : { kind: 'custom', name: `d${custom}` },
        modifiers,
        span: { start, end },
      });
      at = end;
    } else if ((match = matchAt(NUMBER, source, at))) {
      at += match[0].length;
      tokens.push({
        kind: 'number',
        value: Number(match[0]),
        raw: match[0],
        span: { start, end: at },
      });
    } else if ((match = matchAt(IDENTIFIER, source, at))) {
      at += match[0].length;
      tokens.push({ kind: 'identifier', name: match[0], span: { start, end: at } });
    } else if (char === '@') {
      match = matchAt(IDENTIFIER, source, at + 1);
      if (!match) {
        throw new FormulaError(
          'unexpected_character',
          'Expected a name after "@"',
          { start, end: start + 1 },
          source,
        );
      }
      at += 1 + match[0].length;
      tokens.push({ kind: 'reference', name: match[0], span: { start, end: at } });
    } else if (char === "'") {
      at = readString(source, at, tokens);
    } else {
      const punctuation = PUNCTUATION.find((p) => source.startsWith(p, at));
      if (!punctuation) {
        const hint = char === '!' ? '; use "not" for negation' : '';
        throw new FormulaError(
          'unexpected_character',
          `Unexpected character "${char}"${hint}`,
          { start, end: start + 1 },
          source,
        );
      }
      at += punctuation.length;
      tokens.push({ kind: 'punctuation', value: punctuation, span: { start, end: at } });
    }
  }
  tokens.push({ kind: 'end', span: { start: source.length, end: source.length } });
  return tokens;
}

/** Reads `'…'` with `\'` and `\\` escapes; returns the offset after the closing quote. */
function readString(source: string, start: number, tokens: Token[]): number {
  let value = '';
  let at = start + 1;
  while (at < source.length) {
    const char = source.charAt(at);
    if (char === "'") {
      tokens.push({ kind: 'string', value, span: { start, end: at + 1 } });
      return at + 1;
    }
    if (char === '\\') {
      const next = source.charAt(at + 1);
      if (next !== "'" && next !== '\\') {
        throw new FormulaError(
          'invalid_escape',
          "Only \\' and \\\\ can be escaped in a string",
          { start: at, end: Math.min(at + 2, source.length) },
          source,
        );
      }
      value += next;
      at += 2;
    } else {
      value += char;
      at += 1;
    }
  }
  throw new FormulaError(
    'unterminated_string',
    "The string is not closed; add a closing '",
    { start, end: source.length },
    source,
  );
}
