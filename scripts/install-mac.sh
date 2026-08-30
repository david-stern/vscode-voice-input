#!/usr/bin/env bash
# Voice Input — macOS dependency installer
# Audio capture is self-contained; this only verifies optional paste helpers.
set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Voice Input — macOS dependency installer       ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

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
