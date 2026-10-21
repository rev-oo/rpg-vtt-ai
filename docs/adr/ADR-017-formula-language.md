# ADR-017: Formula language details

- **Status:** Accepted
- **Date:** 2026-10-20
- **Tasks:** T-0301, T-0302, T-0303, T-0304
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
8. **Limits.** Nesting deeper than 200, or a tree deeper than 200 (a chain of 200 `+`), is refused, so neither parsing nor evaluation can exhaust the stack.

## Evaluation (T-0302)

1. **Values** are numbers, text and true/false. `[*]` gives a list, which only functions take: `sum`, `min`, `max`, `count`.
2. **Strict types.** Nothing is converted silently:
   - `+` adds two numbers or joins two texts; `- * / %` need numbers.
   - `<`, `<=`, `>` and `>=` compare two numbers or two texts; `==` and `!=` compare values of the same type.
   - `and`, `or`, `not`, `?:` and `if()` need true/false.
   - Anything else is a `type_error` at the operator or operand.
3. **Numbers stay finite.**
   - Dividing by zero is a `division_by_zero` error.
   - Overflow and `NaN` (from data or from a function) are errors too.
4. **Short circuits.** `and`, `or`, `?:` and `if()` evaluate only the branch they need, so `@hp > 0 and @hp.max` works where a branch would fail.
5. **References.**
   - Only own properties of `data` are read, so `@constructor`, `@__proto__` or anything inherited is `unknown_reference`.
   - Lists are indexed only by an integer `[n]`.
   - Collections (id-keyed maps) are indexed by id `['id']`, and `[*]` iterates their values.
   - `count(@skills[*])` counts entries even though they are groups of fields.
6. **Functions.**
   - The whitelist is §8.9's list plus the functions the caller passes (a plugin's `shared` functions).
   - A plugin function cannot replace a built-in.
   - A plugin function's result must be a finite number, text or true/false, and its exceptions become `function_failed`.
7. **Step limit.** Each node, and each element `[*]` visits, is a step; the default limit is 10,000.
8. **Dice.** In pure mode a die is a `dice_not_allowed` error; rolling mode (T-0303) supplies the dice.
9. **Testing.** Property tests evaluate random trees against data and functions whose prototypes trap every inherited read and every non-whitelisted call. None is reached, and no run exceeds its step limit.

## Dice (T-0303)

1. **Rolling mode.** `roll(formula, { rng, customDice, maxDice })` evaluates with dice allowed. It returns the total, which must be a number, and every term's dice.
2. **RNG.** The caller injects an `Rng` (`nextInt(n)` in `[0, n)`): the server passes a cryptographically secure one (FR-CHAT-04).
   - `seededRng(seed)` (mulberry32, rejection-sampled) is deterministic for tests and replays (FR-DICE-05).
   - A replay test pins its output, because stored rolls depend on it.
   - An RNG that answers out of range is a bug and throws `RangeError`.
3. **Modifier order.** Modifiers apply in a fixed order, whatever order they are written in:
   1. **Reroll** (`r`) rerolls a matching die once. The first result stays in the list, marked `rerolled`.
   2. **Explode** (`!`): a die showing its highest value adds another die. That die can be rerolled and explode again.
   3. **Keep or drop** sorts the remaining dice and marks the rest `dropped`. Ties keep their rolling order.
   4. **Success counting** (`cs`, `cf`): with either present, the term is worth successes minus failures; otherwise it is the sum of its active dice.
4. **Custom dice** are lists of faces, each with a `label` and a numeric `value` (Fate: `-`, ` `, `+` as −1, 0, 1). The plugin engine (M4) builds them from `dice.json`.
   - Comparisons, explosions and totals use the value; the label is kept for display.
   - Unknown names are `unknown_die` errors that list the system's dice.
5. **Limits.**
   - Sides go from 1 to 1,000,000.
   - Counts are whole numbers of 0 or more.
   - A roll uses at most 1,000 dice, explosions and rerolls included (`too_many_dice`), which also stops `d1!`.
6. **Results** (FR-DICE-04). Each term records:
   - its formula, with the count resolved (`(@pool)d6` → `3d6`)
   - the count and the die
   - every die, with its value, its label, whether it counts (`active`) and the `rerolled`, `exploded`, `dropped`, `success` and `failure` flags
   - its total

## Roll results (T-0304)

A roll result is plain JSON, ready to store in a chat message. It holds:

- `expression`: the formula as written
- `resolved`: the formula printed canonically, with each reference that was evaluated replaced by its value, and each dice count resolved
  - `1d20 + @derived.strMod + @skills[@args.id].rank` → `1d20 + 2 + 3`
  - `(@pool)d6` → `3d6`
  - A list passed to a function is spread into its arguments: `sum(@skills[*].rank)` → `sum(3, 1)`.
  - References in branches that were not evaluated stay as written.
  - Negating a negative value prints as `-(-1)`.
- `dice`: every term with every die (T-0303)
- `total`

The caller supplies the actor's state as `data` (FR-DICE-02). Until the plugin engine computes derived values (M4), `@derived` holds only what the caller passes.

## Consequences

- `print(ast)` writes canonical source, and `parse(print(ast))` gives the same tree. fast-check checks this on random trees, and checks that random input only ever fails with a `FormulaError` inside the source.
- Dice counts from data need parentheses: `(@pool)d6`, not `@pool d6`.
