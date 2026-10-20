import type { DiceModifier, Expression, PathSegment } from './ast.js';
import { binaryPrecedence, PRECEDENCE, precedenceOf } from './precedence.js';

const MODIFIER_CODE = {
  keep: { highest: 'kh', lowest: 'kl' },
  drop: { highest: 'dh', lowest: 'dl' },
  reroll: 'r',
  success: 'cs',
  failure: 'cf',
} as const;

function printModifier(modifier: DiceModifier): string {
  switch (modifier.kind) {
    case 'keep':
    case 'drop':
      return `${MODIFIER_CODE[modifier.kind][modifier.which]}${String(modifier.count)}`;
    case 'explode':
      return '!';
    default: {
      const { comparator, value } = modifier.comparison;
      return `${MODIFIER_CODE[modifier.kind]}${comparator === '=' ? '' : comparator}${String(value)}`;
    }
  }
}

function printSegment(segment: PathSegment): string {
  switch (segment.kind) {
    case 'field':
      return `.${segment.name}`;
    case 'index':
      return `[${print(segment.index)}]`;
    case 'all':
      return '[*]';
  }
}

/** `node` in parentheses when it binds looser than `min`. */
function wrap(node: Expression, min: number): string {
  const text = print(node);
  return precedenceOf(node) < min ? `(${text})` : text;
}

/**
 * Prints an AST as canonical source: single spaces around operators and only the
 * parentheses precedence needs. `parse(print(ast))` gives the same AST back.
 */
export function print(node: Expression): string {
  switch (node.kind) {
    case 'number':
      return node.raw;
    case 'string':
      return `'${node.value.replace(/[\\']/g, '\\$&')}'`;
    case 'boolean':
      return String(node.value);
    case 'reference':
      return `@${node.name}${node.path.map(printSegment).join('')}`;
    case 'unary':
      return node.operator === '-'
        ? `-${wrap(node.operand, PRECEDENCE.negation)}`
        : `not ${wrap(node.operand, PRECEDENCE.not)}`;
    case 'binary': {
      const precedence = binaryPrecedence(node.operator);
      // Comparisons do not chain, so both sides of one need to bind tighter.
      const left = precedence === PRECEDENCE.comparison ? precedence + 1 : precedence;
      return `${wrap(node.left, left)} ${node.operator} ${wrap(node.right, precedence + 1)}`;
    }
    case 'conditional':
      return `${wrap(node.test, PRECEDENCE.or)} ? ${print(node.then)} : ${print(node.otherwise)}`;
    case 'call':
      return `${node.name}(${node.args.map(print).join(', ')})`;
    case 'dice': {
      const { count } = node;
      const prefix =
        count === null
          ? ''
          : count.kind === 'number' && /^\d+$/.test(count.raw)
            ? count.raw
            : `(${print(count)})`;
      const die = node.die.kind === 'standard' ? `d${String(node.die.sides)}` : node.die.name;
      return `${prefix}${die}${node.modifiers.map(printModifier).join('')}`;
    }
  }
}
