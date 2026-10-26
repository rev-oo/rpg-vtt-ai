# ADR-045: Plugin authoring guide and generated file reference

- **Status:** Accepted
- **Date:** 2026-10-26
- **Tasks:** T-0704
- **Refines:** specs §8, §8.13

## Context

T-0704 asks for `docs/plugin-authoring.md` with the full format, a "build your first plugin" tutorial and a generated schema reference. A developer new to the project should be able to build a plugin from the guide alone.

Specs §8 was written before the plugin system existed, and it differs from what was built:

- sheet files wrap their tree in `layout`;
- dice faces take `values`, and cards read `@roll.resolved`;
- only `code/client` runs in 0.1.0.

A guide copied from the spec would mislead, and a hand-written list of keys would drift from the validator.

## Decision

1. **Two documents.**
   - `docs/plugin-authoring.md` is written by hand: a tutorial, then the format file by file, as 0.1.0 behaves.
   - `docs/plugin-reference.md` lists every key of every file and is generated.
2. **The reference comes from the Zod schemas.**
   - `pluginReference()` in `@vtt/plugin-schema` renders the emitted JSON Schemas as Markdown tables. `pnpm build` writes it next to `schemas/`, and `test/reference.test.ts` fails when the committed file is stale or links to a missing anchor.
   - The schemas gain `description`s, and `title`s for their building blocks (Formula, Text, Name, Field, Node …). The reference reads both, and editors show them on hover through `$schema`. Descriptions carry no Markdown links, since editors show them raw.
   - The generated file is excluded from Prettier, which would realign its tables.
   - `.describe()` cannot be called on a `z.lazy` schema such as the sheet node: the clone rebuilds the recursive tree forever when converted to JSON Schema. Those keys are described by their parent instead.
3. **The tutorial is tested.**
   - Its code blocks carry `file=<path>` in the info string, and each shows the whole file.
   - `packages/plugin-cli/test/tutorial.test.ts` writes the blocks of each step in turn and runs `vtt-plugin validate`, which must pass with no warnings after every step. It then checks the final plugin's derived values and roll with the plugin engine, and packs it.
   - Example error messages in the guide come from real runs of the CLI.
4. **Limits of 0.1.0 are stated up front.** `code/shared` and `code/server` are packed but not run, so handler recipes and calls to non-built-in functions fail when rolled. `combat.json` and `packs/` are reserved.
5. **The setup is the repository.** The CLI and SDK are not published, so the guide builds the repository and aliases `vtt-plugin` to the built CLI. Plugin code gets type checking only inside the repository's `plugins/` folder.

## Consequences

- Changing a plugin schema regenerates the reference in the same build, and the tests fail until it is committed.
- The tutorial cannot silently break: any change to the validator that rejects it fails CI and names the step.
- The tests cannot tell whether a newcomer understands the guide; the reader test in T-0704's done-when checks that.
- Publishing the CLI and SDK would simplify the setup in "Before you start".
