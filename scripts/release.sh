#!/usr/bin/env bash
# release.sh — Verify/package first, then update Git release metadata and push.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
VSIX="voice-input-$VERSION.vsix"
echo "▶  Version: $VERSION"

# Packaging and archive verification intentionally precede every Git mutation.
echo "▶  Testing and building extension…"
npm test
npm run compile
npm run build

if command -v vsce &>/dev/null; then
  VSCE=(vsce)
else
  VSCE=(npx --yes @vscode/vsce)
fi

echo "▶  Checking package contents…"
PACKAGE_LIST="$(mktemp)"
trap 'rm -f "$PACKAGE_LIST"' EXIT
"${VSCE[@]}" ls > "$PACKAGE_LIST"

REQUIRED_PACKAGE_FILES=(
  "extension/out/vendor/pvrecorder-node/lib/linux/x86_64/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/mac/arm64/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/mac/x86_64/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a53-aarch64/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a53/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a72-aarch64/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a72/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a76-aarch64/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a76/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/windows/amd64/pv_recorder.node"
  "extension/out/vendor/pvrecorder-node/lib/windows/arm64/pv_recorder.node"
  "extension/out/licenses/PICOVOICE-LICENSE.txt"
)

for required in "${REQUIRED_PACKAGE_FILES[@]}"; do
  list_path="${required#extension/}"
  if ! grep -Fxq "$list_path" "$PACKAGE_LIST"; then
    echo "✗  Required package file missing from vsce ls: $list_path" >&2
    exit 1
  fi
done

echo "▶  Packaging VSIX…"
"${VSCE[@]}" package -o "$VSIX"

ARCHIVE_LIST="$(unzip -Z1 "$VSIX")"
for required in "${REQUIRED_PACKAGE_FILES[@]}"; do
  if ! grep -Fxq "$required" <<<"$ARCHIVE_LIST"; then
    echo "✗  Required file missing from VSIX archive: $required" >&2
    exit 1
  fi
done
echo "✓  Package verified: $VSIX"

# Only a verified package may proceed to Git mutations.
echo "▶  Syncing docs…"
sed -i "s/Version: [0-9]\+\.[0-9]\+\.[0-9]\+/Version: $VERSION/g" README.md || true

TODAY="$(date +%Y-%m-%d)"
if ! grep -qF "## [$VERSION]" CHANGELOG.md; then
  TMP="$(mktemp)"
  printf "## [%s] — %s\n\n- Release %s\n\n" "$VERSION" "$TODAY" "$VERSION" | cat - CHANGELOG.md > "$TMP"
  mv "$TMP" CHANGELOG.md
  echo "   Added CHANGELOG entry for $VERSION"
fi

echo "▶  Staging changes…"
git add README.md CHANGELOG.md package.json package-lock.json
git add -u

if git diff --cached --quiet; then
  echo "   Nothing to commit."
else
  git commit -m "chore: release v$VERSION"
  echo "   Committed: chore: release v$VERSION"
fi

TAG="v$VERSION"
if git tag -l "$TAG" | grep -Fxq "$TAG"; then
  echo "   Tag $TAG already exists — skipping."
else
  git tag -a "$TAG" -m "Release $TAG"
  echo "   Tagged: $TAG"
fi

echo "▶  Pushing to remote…"
git push
git push --tags
echo "✔  Done → $VSIX"
