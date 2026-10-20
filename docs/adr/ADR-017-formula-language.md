# ADR-017: Formula language details

- **Status:** Accepted
- **Date:** 2026-10-20
- **Tasks:** T-0301
- **Amends:** §8.8 (custom dice names), §8.9 (grammar details), §14 Q8

## Context

§8.9 summarises the formula grammar but leaves its edges open: how dice terms are told apart from names, where dice counts can come from, how operators bind, and what an error looks like. These choices are hard to change once plugins rely on them.

## Decision

1. **Parser.** `@vtt/formula` has a hand-written lexer and Pratt parser with no dependencies (Q8). Every AST node keeps its source span.
2. **Precedence**, loosest first:
   1. `?:` (right-associative)
   2. `or`
   3. `and`
   4. `not`
   5. comparisons
   6. `+ -`
   7. `* / %`
   8. unary `-`

   Comparisons do not chain: `1 < @a < 3` is an error that suggests `and`. `!` is not negation: the error suggests `not`.

3. **Dice terms.**
   - The count may be left out (`d20`), and `(expr)` may give it (`(@pool)d6`), as pool systems need. The `(` must touch the `d`.
   - Sides are an integer.
   - Each modifier appears once at most, in any order:
     - **keep or drop:** `kh`, `kl`, `dh` or `dl`, with a count that defaults to 1
     - **explode:** `!`
     - **reroll and success counting:** `r`, `cs` or `cf`, followed by an optional comparator (`=`, `<`, `<=`, `>`, `>=`, where a bare number means `=`) and an integer
   - `!=` right after a die is a comparison, not an explosion (`2d6!=7`).
4. **Custom dice names** are `d` followed by uppercase letters and digits (`dF`, `dB2`). The lowercase modifiers after them stay unambiguous (`4dFcs>=1`). The plugin validator (M4) enforces this pattern on `dice.json` keys.
5. **Names.**
   - A bare word must be a function call or a keyword (`and`, `or`, `not`, `true`, `false`).
   - Anything else is an error that suggests the `@` reference.
   - Function names are checked by the evaluator, so plugins' `shared` functions need no parser change.
6. **Strings** use single quotes; only `\'` and `\\` are escapes.
7. **Errors** are `FormulaError`s with a `code`, the `span`, a 1-based `line` and `column`, and an English message ending in `(line L, column C)`. Callers can word them differently from the code.
8. **Limits.** Nesting deeper than 100 is refused, so a formula cannot exhaust the stack.

## Consequences

- `print(ast)` writes canonical source, and `parse(print(ast))` gives the same tree. fast-check checks this on random trees, and checks that random input only ever fails with a `FormulaError` inside the source.
- Dice counts from data need parentheses: `(@pool)d6`, not `@pool d6`.
