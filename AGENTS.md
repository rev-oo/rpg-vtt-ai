# General Guidelines

- Always open `specs.md` before working
- Always use pnpm as package manager
- Always update **Progress Tracker** after you finish a milestone
- Always tick the corresponding milestone once it is complete. Await confirmation from the user if it can be considered done or not
- Always respect the package layer boundaries (`specs.md` §4.4); `pnpm lint` enforces them via `packages/config/eslint/workspace.mjs`. Register any new package there. Never silence a boundary error with `eslint-disable` or a relative-path import; record the conflict in `specs.md` §14 instead
