import {
  childrenOf,
  COMPARISON_OPERATORS,
  type BinaryOperator,
  type ComparisonOperator,
  type Expression,
  type PathSegment,
  type Reference,
  type Span,
} from './ast.js';
import { FormulaError } from './errors.js';
import { tokenize, type DiceToken, type Punctuation, type Token } from './lexer.js';
import { binaryPrecedence, PRECEDENCE } from './precedence.js';

/**
 * Formulas nested deeper than this, or whose tree is deeper (a chain of 300 `+`), are refused,
 * so neither parsing nor evaluation can exhaust the stack.
 */
export const MAX_DEPTH = 200;

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);

const isComparison = (operator: string): operator is ComparisonOperator =>
  (COMPARISON_OPERATORS as readonly string[]).includes(operator);

const join = (from: Span, to: Span): Span => ({ start: from.start, end: to.end });

/** The binary operator, or `?`, that a token continues an expression with. */
function infixOf(token: Token): BinaryOperator | '?' | null {
  if (token.kind === 'identifier' && (token.name === 'and' || token.name === 'or')) {
    return token.name;
  }
  if (token.kind !== 'punctuation') return null;
  switch (token.value) {
    case '?':
    case '+':
    case '-':
    case '*':
    case '/':
    case '%':
      return token.value;
    default:
      return isComparison(token.value) ? token.value : null;
  }
}

class Parser {
  private readonly tokens: Token[];
  private readonly end: Token;
  private position = 0;
  private depth = 0;

  constructor(private readonly source: string) {
    this.tokens = tokenize(source);
    this.end = { kind: 'end', span: { start: source.length, end: source.length } };
  }

  parse(): Expression {
    if (this.peek().kind === 'end') {
      throw this.error('unexpected_end', 'The formula is empty', this.peek().span);
    }
    const expression = this.expression();
    const rest = this.peek();
    if (rest.kind !== 'end') throw this.unexpected(rest);
    this.checkDepth(expression);
    return expression;
  }

  private tooDeep(span: Span): FormulaError {
    return this.error('too_deep', 'The formula is too long or nested too deeply', span);
  }

  /** Walks the tree without recursion, so the check itself cannot run out of stack. */
  private checkDepth(root: Expression): void {
    const pending: [Expression, number][] = [[root, 1]];
    for (let entry = pending.pop(); entry; entry = pending.pop()) {
      const [node, depth] = entry;
      if (depth > MAX_DEPTH) throw this.tooDeep(node.span);
      for (const child of childrenOf(node)) pending.push([child, depth + 1]);
    }
  }

  private peek(): Token {
    // The list always ends with `end`, and `next` never moves past it.
    return this.tokens[this.position] ?? this.end;
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.position += 1;
    return token;
  }

  private isPunctuation(token: Token, value: Punctuation): boolean {
    return token.kind === 'punctuation' && token.value === value;
  }

  private expect(value: Punctuation): Token {
    const token = this.next();
    if (this.isPunctuation(token, value)) return token;
    if (token.kind === 'end') {
      throw this.error('unexpected_end', `Expected "${value}", but the formula ends`, token.span);
    }
    throw this.error(
      'unexpected_token',
      `Expected "${value}" but found "${this.text(token)}"`,
      token.span,
    );
  }

  private text(token: Token): string {
    return this.source.slice(token.span.start, token.span.end);
  }

  private error(code: FormulaError['code'], detail: string, span: Span): FormulaError {
    return new FormulaError(code, detail, span, this.source);
  }

  private unexpected(token: Token): FormulaError {
    if (token.kind === 'end') {
      return this.error('unexpected_end', 'The formula ends too early', token.span);
    }
    return this.error('unexpected_token', `Unexpected "${this.text(token)}"`, token.span);
  }

  /** Pratt loop: a prefix, then every infix operator that binds at least `min`. */
  private expression(min: number = PRECEDENCE.conditional): Expression {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw this.tooDeep(this.peek().span);
    let left = this.prefix();
    for (;;) {
      const token = this.peek();
      const operator = infixOf(token);
      if (operator === null) break;
      const precedence = operator === '?' ? PRECEDENCE.conditional : binaryPrecedence(operator);
      if (precedence < min) break;
      this.next();

      if (operator === '?') {
        const then = this.expression();
        this.expect(':');
        // Right-associative: `a ? b : c ? d : e` nests in the last branch.
        const otherwise = this.expression(PRECEDENCE.conditional);
        left = {
          kind: 'conditional',
          test: left,
          then,
          otherwise,
          span: join(left.span, otherwise.span),
        };
        continue;
      }
      const right = this.expression(precedence + 1);
      left = { kind: 'binary', operator, left, right, span: join(left.span, right.span) };
      if (isComparison(operator)) {
        const chained = this.peek();
        const following = infixOf(chained);
        if (following !== null && following !== '?' && isComparison(following)) {
          throw this.error(
            'chained_comparison',
            'Comparisons cannot be chained; join them with "and"',
            chained.span,
          );
        }
      }
    }
    this.depth -= 1;
    return left;
  }

  private prefix(): Expression {
    const token = this.next();
    switch (token.kind) {
      case 'number':
        return { kind: 'number', value: token.value, raw: token.raw, span: token.span };
      case 'string':
        return { kind: 'string', value: token.value, span: token.span };
      case 'reference':
        return this.reference(token.name, token.span);
      case 'dice':
        return this.dice(token, null, token.span);
      case 'identifier':
        return this.word(token.name, token.span);
      case 'punctuation':
        if (token.value === '(') return this.group(token.span);
        if (token.value === '-') {
          const operand = this.expression(PRECEDENCE.negation);
          return { kind: 'unary', operator: '-', operand, span: join(token.span, operand.span) };
        }
        throw this.unexpected(token);
      case 'end':
        throw this.unexpected(token);
    }
  }

  private word(name: string, span: Span): Expression {
    if (name === 'true' || name === 'false') {
      return { kind: 'boolean', value: name === 'true', span };
    }
    if (name === 'not') {
      const operand = this.expression(PRECEDENCE.not);
      return { kind: 'unary', operator: 'not', operand, span: join(span, operand.span) };
    }
    if (KEYWORDS.has(name)) {
      throw this.error('unexpected_token', `Unexpected "${name}"`, span);
    }
    if (!this.isPunctuation(this.peek(), '(')) {
      throw this.error(
        'unknown_name',
        `Unknown name "${name}"; references start with "@", as in @${name}`,
        span,
      );
    }
    this.next();
    const args: Expression[] = [];
    if (!this.isPunctuation(this.peek(), ')')) {
      for (;;) {
        args.push(this.expression());
        if (!this.isPunctuation(this.peek(), ',')) break;
        this.next();
      }
    }
    const close = this.expect(')');
    return { kind: 'call', name, args, span: join(span, close.span) };
  }

  /** `( … )`, which may give the count of a die right after it: `(@pool)d6`. */
  private group(open: Span): Expression {
    const inner = this.expression();
    const close = this.expect(')');
    const following = this.peek();
    if (
      following.kind === 'dice' &&
      following.count === null &&
      following.span.start === close.span.end
    ) {
      this.next();
      return this.dice(following, inner, join(open, following.span));
    }
    return { ...inner, span: join(open, close.span) };
  }

  private dice(token: DiceToken, count: Expression | null, span: Span): Expression {
    const literal: Expression | null =
      token.count === null || token.countRaw === null
        ? null
        : {
            kind: 'number',
            value: token.count,
            raw: token.countRaw,
            span: { start: token.span.start, end: token.span.start + token.countRaw.length },
          };
    return {
      kind: 'dice',
      count: count ?? literal,
      die: token.die,
      modifiers: token.modifiers,
      span,
    };
  }

  private reference(name: string, start: Span): Reference {
    const path: PathSegment[] = [];
    let span = start;
    for (;;) {
      const token = this.peek();
      if (this.isPunctuation(token, '.')) {
        this.next();
        const field = this.next();
        if (field.kind !== 'identifier') {
          throw field.kind === 'end'
            ? this.error('unexpected_end', 'Expected a field name after "."', field.span)
            : this.error(
                'unexpected_token',
                `Expected a field name after "." but found "${this.text(field)}"`,
                field.span,
              );
        }
        path.push({ kind: 'field', name: field.name });
        span = join(start, field.span);
      } else if (this.isPunctuation(token, '[')) {
        this.next();
        const star = this.peek();
        if (this.isPunctuation(star, '*')) {
          this.next();
          path.push({ kind: 'all' });
        } else {
          path.push({ kind: 'index', index: this.expression() });
        }
        span = join(start, this.expect(']').span);
      } else {
        return { kind: 'reference', name, path, span };
      }
    }
  }
}

/**
 * Parses a formula (specs §8.9) into an AST. Throws a `FormulaError` with the line and
 * column of the first problem.
 */
export function parse(source: string): Expression {
  return new Parser(source).parse();
}
