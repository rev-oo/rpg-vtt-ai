#!/usr/bin/env bash
# Prints the CHANGELOG.md section of a version, for its GitHub release (T-0705, ADR-046).
# Fails when the version is not the workspace's or has no section, so a mistyped tag
# publishes nothing.
set -euo pipefail

version="${1:?usage: scripts/release-notes.sh <version>}"
root="$(cd "$(dirname "$0")/.." && pwd)"

package_version="$(node -p "require('$root/package.json').version")"
if [[ "$version" != "$package_version" ]]; then
  echo "Version $version does not match package.json ($package_version)." >&2
  exit 1
fi

notes="$(awk -v heading="## [$version]" '
  index($0, heading) == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found && /^\[[^]]+\]: / { exit }
  found { print }
' "$root/CHANGELOG.md")"

if [[ -z "${notes//[[:space:]]/}" ]]; then
  echo "CHANGELOG.md has no section for $version." >&2
  exit 1
fi
printf '%s\n' "$notes" | sed -e '/./,$!d'
