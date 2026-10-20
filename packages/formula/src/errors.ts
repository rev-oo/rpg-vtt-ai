import type { Span } from './ast.js';

export type FormulaErrorCode =
  // Syntax (T-0301)
  | 'unexpected_character'
  | 'unterminated_string'
  | 'invalid_escape'
  | 'unexpected_token'
  | 'unexpected_end'
  | 'unknown_name'
  | 'chained_comparison'
  | 'duplicate_modifier'
  | 'too_deep'
  // Evaluation (T-0302)
  | 'unknown_reference'
  | 'unknown_function'
  | 'invalid_arguments'
  | 'invalid_value'
  | 'type_error'
  | 'division_by_zero'
  | 'not_finite'
  | 'function_failed'
  | 'dice_not_allowed'
  | 'step_limit';

/** A 1-based line and column in the formula source. */
export interface SourcePosition {
  line: number;
  column: number;
}

/** The line and column of an offset, counting `\n` as the line break. */
export function positionAt(source: string, offset: number): SourcePosition {
  const before = source.slice(0, Math.max(0, Math.min(offset, source.length)));
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length, column: before.length - lineStart + 1 };
}

/**
 * A formula that cannot be parsed or evaluated. `message` is English and ends with the
 * position; `code` and `span` let a caller word it differently.
 */
export class FormulaError extends Error {
  override readonly name = 'FormulaError';
  readonly line: number;
  readonly column: number;

  constructor(
    readonly code: FormulaErrorCode,
    readonly detail: string,
    readonly span: Span,
    source: string,
  ) {
    const { line, column } = positionAt(source, span.start);
    super(`${detail} (line ${String(line)}, column ${String(column)})`);
    this.line = line;
    this.column = column;
  }
}
