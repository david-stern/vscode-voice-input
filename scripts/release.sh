#!/usr/bin/env bash
# release.sh — build and inspect a local VSIX. It never commits, tags, pushes, or publishes.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
VSIX="voice-input-$VERSION.vsix"
echo "▶  Version: $VERSION"

VSCE="$REPO_ROOT/node_modules/.bin/vsce"
if [[ ! -x "$VSCE" ]]; then
  echo "✗  Locked local @vscode/vsce is missing. Run npm ci before packaging." >&2
  exit 1
fi
EXPECTED_VSCE_VERSION="$(node -p "require('./package.json').devDependencies['@vscode/vsce']")"
ACTUAL_VSCE_VERSION="$("$VSCE" --version)"
if [[ ! "$EXPECTED_VSCE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || [[ "$ACTUAL_VSCE_VERSION" != "$EXPECTED_VSCE_VERSION" ]]; then
  echo "✗  Local vsce version $ACTUAL_VSCE_VERSION does not match the exact package pin $EXPECTED_VSCE_VERSION." >&2
  exit 1
fi

echo "▶  Running the release gate (typecheck, lint, tests, build)…"
npm run release:verify

echo "▶  Checking package contents…"
PACKAGE_LIST="$(mktemp)"
trap 'rm -f "$PACKAGE_LIST"' EXIT
"$VSCE" ls > "$PACKAGE_LIST"

REQUIRED_VSCE_LIST_FILES=(
  "package.json"
  "README.md"
  "LICENSE"
  "CHANGELOG.md"
  "out/extension.js"
  "out/webview/mic.client.js"
  "out/webview/settings.client.js"
  "out/vendor/pvrecorder-node/lib/linux/x86_64/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/mac/arm64/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/mac/x86_64/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a53-aarch64/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a53/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a72-aarch64/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a72/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a76-aarch64/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a76/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/windows/amd64/pv_recorder.node"
  "out/vendor/pvrecorder-node/lib/windows/arm64/pv_recorder.node"
  "out/licenses/PICOVOICE-LICENSE.txt"
)

REQUIRED_ARCHIVE_FILES=(
  "extension/package.json"
  "extension/readme.md"
  "extension/LICENSE.txt"
  "extension/changelog.md"
  "extension/out/extension.js"
  "extension/out/webview/mic.client.js"
  "extension/out/webview/settings.client.js"
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

for required in "${REQUIRED_VSCE_LIST_FILES[@]}"; do
  if ! grep -Fxq "$required" "$PACKAGE_LIST"; then
    echo "✗  Required package file missing from vsce ls: $required" >&2
    exit 1
  fi
done

echo "▶  Packaging local VSIX…"
"$VSCE" package --no-dependencies -o "$VSIX"

ARCHIVE_LIST="$(unzip -Z1 "$VSIX")"
for required in "${REQUIRED_ARCHIVE_FILES[@]}"; do
  if ! grep -Fxq "$required" <<<"$ARCHIVE_LIST"; then
    echo "✗  Required file missing from VSIX archive: $required" >&2
    exit 1
  fi
done

echo "▶  Validating packaged manifest…"
MANIFEST="$(unzip -p "$VSIX" extension/package.json)"
node -e '
const manifest = JSON.parse(process.argv[1]);
const version = process.argv[2];
const fail = (message) => { console.error(`✗  ${message}`); process.exit(1); };
if (manifest.version !== version) fail(`manifest version is ${manifest.version}, expected ${version}`);
if (manifest.engines?.vscode !== "^1.99.0") fail("manifest must require VS Code ^1.99.0");
const views = manifest.contributes?.views?.voiceInput ?? [];
const viewIds = views.map((view) => view.id);
if (viewIds.length !== 2 || !viewIds.includes("voiceInput.micView") || !viewIds.includes("voiceInput.settingsView")) fail("manifest must contribute the Microphone and Settings views");
const commands = manifest.contributes?.commands ?? [];
if (!commands.some((command) => command.command === "voiceInput.openSettings")) fail("manifest must contribute voiceInput.openSettings");
const tools = manifest.contributes?.languageModelTools ?? [];
const toolNames = tools.map((tool) => tool.name).sort();
if (toolNames.length !== 2 || toolNames[0] !== "voice-input_listMappings" || toolNames[1] !== "voice-input_runMapping") fail("manifest must contribute both Voice Input Agent tools");
' "$MANIFEST" "$VERSION"

echo "▶  Rejecting development and secret-like package paths…"
if grep -Eiq '(^|/)(src|test|tests|\.omc|node_modules)/|\.map$|(^|/)\.env($|\.)|(^|/)(secrets?|credentials?)(/|$)' <<<"$ARCHIVE_LIST"; then
  echo "✗  VSIX contains a forbidden source, test, map, state, dependency, or secret-like path." >&2
  exit 1
fi

echo "▶  Verifying packaged browser bundles…"
for bundle in mic.client.js settings.client.js; do
  local_hash="$(sha256sum "out/webview/$bundle" | awk '{print $1}')"
  archive_hash="$(unzip -p "$VSIX" "extension/out/webview/$bundle" | sha256sum | awk '{print $1}')"
  if [[ "$local_hash" != "$archive_hash" ]]; then
    echo "✗  Packaged $bundle does not match the built bundle." >&2
    exit 1
  fi
  echo "   $bundle $local_hash"
done

echo "✓  Local package verified: $VSIX"
echo "   SHA-256: $(sha256sum "$VSIX" | awk '{print $1}')"
