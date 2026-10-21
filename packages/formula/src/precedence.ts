import type { BinaryOperator, Expression } from './ast.js';

/** Binding strength, loosest first (specs §8.9). */
export const PRECEDENCE = {
  conditional: 1,
  or: 2,
  and: 3,
  not: 4,
  comparison: 5,
  additive: 6,
  multiplicative: 7,
  negation: 8,
  atom: 9,
} as const;

export function binaryPrecedence(operator: BinaryOperator): number {
  switch (operator) {
    case 'or':
      return PRECEDENCE.or;
    case 'and':
      return PRECEDENCE.and;
    case '+':
    case '-':
      return PRECEDENCE.additive;
    case '*':
    case '/':
    case '%':
      return PRECEDENCE.multiplicative;
    default:
      return PRECEDENCE.comparison;
  }
}

export function precedenceOf(node: Expression): number {
  switch (node.kind) {
    case 'conditional':
      return PRECEDENCE.conditional;
    case 'binary':
      return binaryPrecedence(node.operator);
    case 'unary':
      return node.operator === 'not' ? PRECEDENCE.not : PRECEDENCE.negation;
    default:
      return PRECEDENCE.atom;
  }
}
