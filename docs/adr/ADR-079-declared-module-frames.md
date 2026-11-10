# ADR-079: Declared module frames and system dice

- **Status:** Accepted
- **Date:** 2026-11-10
- **Tasks:** T-1612
- **Covers:** FR-PLUGIN-16
- **Builds on:** ADR-074 (plugin frames), ADR-077 (module overlays and panels)

## Context

The dice-3d study (`docs/studies/dice-3d.md`, F1, F3 and F6) found three things:

- Before showing a module's overlays and panels, the app ran its `code/client.js` in a hidden probe frame to list them. Each table load therefore parsed the code once more than needed: for dice-3d, that is 627 KB of three.js and cannon-es.
- Where `vtt-plugin pack` finds npm packages was undocumented, and so were the files it leaves out.
- A module could not see the table system's custom dice, so dice-3d left `dF` and the like out.

## Decision

1. **`plugin.json` declares a module's frames.** `frames.overlays` names each overlay, with `interactive`. `frames.panels` names each panel, with its `title` (a lang key or text).
   - The app reads them from the manifest and starts no probe frame for modules.
   - Systems still probe their code for custom nodes and cards, which sheets and cards name.
   - `interactive` and `title` leave the SDK's `OverlayDefinition` and `PanelDefinition`, which keep only `component`, so each fact lives in one place.
   - The validator refuses `frames` in a system (`module_key`) and without code (`code_required`), and checks panel titles as lang keys.
   - A declared frame the code does not export fails like any frame that throws. An exported one that is not declared never shows.
2. **Module frames get the system's custom dice.**
   - Each frame's setup carries the table system's `dice.json` dice: their labels translated for the viewer, and their faces as `{ label, value }`, worked out as the formula engine does.
   - A `dice` message updates them, because the system may load after the frame starts.
   - `useSystemDice()` in `@vtt/sdk/client` reads them.
   - Die names are documented: `d<sides>` for standard dice, the `dice.json` name for custom ones.
3. **Packing is documented and measured.**
   - The guide says where `pack` resolves imports, which files it leaves out, and how to give `code/` a `package.json`.
   - `pack` prints each bundle's size and warns about one over 1 MiB.

## Consequences

- dice-3d loads its code once per overlay. It throws a custom die as the polyhedron with the same number of faces, labelled as the system labels them, so `dF` lands as a d6 with `-`, blank and `+` faces. Custom dice whose face count has no polyhedron are still left out.
- Modules written before this need a `frames` entry in `plugin.json`, or their overlays and panels no longer show. The format is not frozen until T-1701, and the two modules in this repository (dice-3d and the e2e module) are updated.
- The warning threshold is a constant, not a setting. A module that must be large can ignore the warning.
