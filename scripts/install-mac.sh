#!/usr/bin/env bash
# Voice Input — macOS dependency installer
# Run once after installing the extension to get ffmpeg.
set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Voice Input — macOS dependency installer       ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Homebrew ────────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo "⚠  Homebrew not found. Installing Homebrew first..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Homebrew on Apple Silicon installs to /opt/homebrew — add to PATH for this session.
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  echo "✓  Homebrew installed."
else
  echo "✓  Homebrew already present."
fi

# ── ffmpeg ───────────────────────────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
  echo "→  Installing ffmpeg..."
  brew install ffmpeg
  echo "✓  ffmpeg installed."
else
  echo "✓  ffmpeg already installed ($(ffmpeg -version 2>&1 | head -1 | awk '{print $3}'))."
fi

# ── Built-ins check ──────────────────────────────────────────────────────────
echo ""
echo "Built-in tools (no install needed):"
for bin in osascript pbcopy pbpaste; do
  if command -v "$bin" &>/dev/null; then
    echo "  ✓  $bin"
  else
    echo "  ✗  $bin  ← unexpected, should ship with macOS"
  fi
done

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  All done!                                                           ║"
echo "║  Next: grant VSCode microphone access in                            ║"
echo "║  System Settings → Privacy & Security → Microphone                  ║"
echo "║  (macOS will prompt automatically on first recording attempt)        ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
