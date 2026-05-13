#!/usr/bin/env bash
# Voice Input — Linux dependency installer (Wayland & X11, apt / dnf / pacman)
# Run once after installing the extension.
set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Voice Input — Linux dependency installer       ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Detect session type ──────────────────────────────────────────────────────
if [[ -n "${WAYLAND_DISPLAY:-}" ]] || [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
  SESSION="wayland"
else
  SESSION="x11"
fi
echo "Session type : $SESSION"

# ── Detect package manager ───────────────────────────────────────────────────
if command -v apt-get &>/dev/null; then
  PM="apt"
elif command -v dnf &>/dev/null; then
  PM="dnf"
elif command -v pacman &>/dev/null; then
  PM="pacman"
elif command -v zypper &>/dev/null; then
  PM="zypper"
else
  echo ""
  echo "✗  Unsupported package manager."
  echo "   Please install the following packages manually:"
  echo "   • ffmpeg"
  if [[ "$SESSION" == "wayland" ]]; then
    echo "   • ydotool   (+ enable ydotoold systemd service)"
    echo "   • wl-clipboard  (provides wl-copy)"
  else
    echo "   • xdotool"
    echo "   • xclip"
  fi
  exit 1
fi
echo "Package manager: $PM"
echo ""

# ── Build package list ───────────────────────────────────────────────────────
PKGS_APT_WAYLAND=(ffmpeg ydotool wl-clipboard)
PKGS_APT_X11=(ffmpeg xdotool xclip)
PKGS_DNF_WAYLAND=(ffmpeg ydotool wl-clipboard)
PKGS_DNF_X11=(ffmpeg xdotool xclip)
PKGS_PAC_WAYLAND=(ffmpeg ydotool wl-clipboard)
PKGS_PAC_X11=(ffmpeg xdotool xclip)
PKGS_ZYP_WAYLAND=(ffmpeg ydotool wl-clipboard)
PKGS_ZYP_X11=(ffmpeg xdotool xclip)

install_packages() {
  local pkgs=("$@")
  echo "→  Installing: ${pkgs[*]}"
  case "$PM" in
    apt)    sudo apt-get install -y "${pkgs[@]}" ;;
    dnf)    sudo dnf install -y "${pkgs[@]}" ;;
    pacman) sudo pacman -S --needed --noconfirm "${pkgs[@]}" ;;
    zypper) sudo zypper install -y "${pkgs[@]}" ;;
  esac
}

# ── Install per session type ─────────────────────────────────────────────────
if [[ "$SESSION" == "wayland" ]]; then
  case "$PM" in
    apt)    install_packages "${PKGS_APT_WAYLAND[@]}" ;;
    dnf)    install_packages "${PKGS_DNF_WAYLAND[@]}" ;;
    pacman) install_packages "${PKGS_PAC_WAYLAND[@]}" ;;
    zypper) install_packages "${PKGS_ZYP_WAYLAND[@]}" ;;
  esac
else
  case "$PM" in
    apt)    install_packages "${PKGS_APT_X11[@]}" ;;
    dnf)    install_packages "${PKGS_DNF_X11[@]}" ;;
    pacman) install_packages "${PKGS_PAC_X11[@]}" ;;
    zypper) install_packages "${PKGS_ZYP_X11[@]}" ;;
  esac
fi

# ── ydotoold systemd service (Wayland only) ──────────────────────────────────
if [[ "$SESSION" == "wayland" ]] && command -v ydotool &>/dev/null; then
  SERVICE_FILE="/etc/systemd/system/ydotoold.service"

  if systemctl is-active --quiet ydotoold 2>/dev/null; then
    echo "✓  ydotoold service already running."
  else
    echo "→  Configuring ydotoold systemd service..."

    # Determine the ydotoold binary path
    YDOTOOLD_BIN=$(command -v ydotoold 2>/dev/null || echo "/usr/bin/ydotoold")

    sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=ydotool daemon
After=network.target

[Service]
Type=simple
ExecStart=${YDOTOOLD_BIN} --socket-path=/tmp/.ydotool_socket --socket-own=$(id -u):$(id -g)
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable --now ydotoold.service
    echo "✓  ydotoold service enabled and started."
  fi
fi

# ── Verify ───────────────────────────────────────────────────────────────────
echo ""
echo "Installed tool check:"
REQUIRED_BINS=(ffmpeg)
if [[ "$SESSION" == "wayland" ]]; then
  REQUIRED_BINS+=(ydotool wl-copy)
else
  REQUIRED_BINS+=(xdotool)
fi

ALL_OK=true
for bin in "${REQUIRED_BINS[@]}"; do
  if command -v "$bin" &>/dev/null; then
    echo "  ✓  $bin"
  else
    echo "  ✗  $bin  ← still missing, check above for errors"
    ALL_OK=false
  fi
done

echo ""
if $ALL_OK; then
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  All done! Reload VSCode to start using Voice Input. ║"
  echo "╚══════════════════════════════════════════════════════╝"
else
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  Some tools failed to install — see errors above.   ║"
  echo "╚══════════════════════════════════════════════════════╝"
fi
echo ""
