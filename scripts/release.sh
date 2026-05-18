#!/usr/bin/env bash
# release.sh — Build, update docs, commit, tag, push, and package VSIX
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── 1. Read current version from package.json ──────────────────────────────
VERSION="$(node -p "require('./package.json').version")"
echo "▶  Version: $VERSION"

# ── 2. Build the extension ─────────────────────────────────────────────────
echo "▶  Building extension…"
npm run build

# ── 3. Sync README badge / version line (non-fatal if sed finds nothing) ───
echo "▶  Syncing docs…"
# Update any "Version: X.Y.Z" token in README.md if present
sed -i "s/Version: [0-9]\+\.[0-9]\+\.[0-9]\+/Version: $VERSION/g" README.md || true

# If a CHANGELOG.md exists, ensure today's date header is present
CHANGELOG="CHANGELOG.md"
TODAY="$(date +%Y-%m-%d)"
if [[ -f "$CHANGELOG" ]]; then
  if ! grep -qF "## [$VERSION]" "$CHANGELOG"; then
    # Prepend a new entry at the top of the file
    TMP="$(mktemp)"
    printf "## [%s] — %s\n\n- Release %s\n\n" "$VERSION" "$TODAY" "$VERSION" | cat - "$CHANGELOG" > "$TMP"
    mv "$TMP" "$CHANGELOG"
    echo "   Added CHANGELOG entry for $VERSION"
  fi
fi

# ── 4. Stage all tracked changes (docs + build artifacts) ─────────────────
echo "▶  Staging changes…"
git add README.md CHANGELOG.md package.json ${CHANGELOG:+$CHANGELOG}

# Stage anything else already tracked that was modified
git add -u

# ── 5. Commit (skip if nothing to commit) ─────────────────────────────────
if git diff --cached --quiet; then
  echo "   Nothing to commit — working tree is clean."
else
  git commit -m "chore: release v$VERSION"
  echo "   Committed: chore: release v$VERSION"
fi

# ── 6. Tag the release ────────────────────────────────────────────────────
TAG="v$VERSION"
if git tag -l "$TAG" | grep -q "$TAG"; then
  echo "   Tag $TAG already exists — skipping."
else
  git tag -a "$TAG" -m "Release $TAG"
  echo "   Tagged: $TAG"
fi

# ── 7. Push to remote (commits + tags) ────────────────────────────────────
echo "▶  Pushing to remote…"
git push
git push --tags

# ── 8. Package VSIX ────────────────────────────────────────────────────────
echo "▶  Packaging VSIX…"
if ! command -v vsce &>/dev/null; then
  echo "   vsce not found — installing…"
  npm install -g @vscode/vsce
fi

vsce package --no-dependencies -o "voice-input-$VERSION.vsix"
echo "✔  Done → voice-input-$VERSION.vsix"
