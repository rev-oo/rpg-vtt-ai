# ADR-046: Releases: version tags publish the image and the release notes

- **Status:** Accepted
- **Date:** 2026-10-26
- **Tasks:** T-0705
- **Refines:** specs §6.4, ADR-044

## Context

T-0705 releases 0.1.0: a changelog, a version bump, the tag `v0.1.0`, a published Docker image and release notes. It is done when the tag exists and CI publishes the image. Until now CI built the image on every push only to smoke-test it, and every workspace package was at `0.0.0`.

## Decision

1. **One version for the workspace.** Every `package.json` carries the release version, starting at `0.1.0`. The packages are private and released together, so they are never versioned apart. The plugin core API version (`CORE_API_VERSION`) is a separate contract and changes only when the plugin format does.
2. **`CHANGELOG.md` at the root**, in the Keep a Changelog format. Each release has a section, which becomes its GitHub release notes. Changes are listed under `[Unreleased]` until the next release.
3. **A `v*` tag releases.**
   - CI runs on the tag like on main: every check, the end-to-end suite and the Docker smoke test.
   - A `release` job then runs only when they pass:
     - it pushes the image to `ghcr.io/rev-oo/rpg-vtt-ai` with the tags `<major>.<minor>.<patch>` and `<major>.<minor>`;
     - it creates the GitHub release from the changelog section.
   - The job has the only write permissions in the workflow (`packages`, `contents`), and logs in with the workflow's own token, so no secret is stored.
4. **`scripts/release-notes.sh <version>`** prints a version's changelog section. It fails when the version differs from `package.json` or has no section, so a mistyped tag publishes nothing.
5. **No `latest` tag, and `linux/amd64` only.** Operators pin a version, since 0.x versions may break stored data. ARM images can come once a build for them is tested.
6. **Release steps.** Bump the versions and move `[Unreleased]` into a dated section in a PR. Merge it, then tag the merge commit on main and push the tag.

## Consequences

- Releasing is one `git push` of a tag, and a failed check stops it before anything is published.
- Re-running a failed release job pushes the same image tags again, but `gh release create` fails if the release already exists; delete that release first.
- The image's first publication creates the GHCR package. Its visibility has to be checked once in the package settings, so the image can be pulled without signing in.
