# Voice Input — Soniox STT for VSCode

Push-to-talk voice-to-text that works in **any** input across VSCode — code editor, GitHub Copilot Chat, Claude Code chat, terminals, settings forms. Audio is captured natively (no flaky webview microphone), transcribed via the Soniox STT API, and pasted into the focused element.

Hebrew is the default language. The full UI is bilingual (he / en) with native RTL support.

---

## Features

- **Background recording.** Toggles recording from anywhere (default: `Alt+M` on Linux/Win, `Ctrl+Alt+M` on macOS) — customizable in sidebar, shows your configured shortcut dynamically.
- **Universal injection.** Editor → cursor insertion. Chat webviews / panels → clipboard + `Ctrl+V` simulated via `ydotool`. Works around VSCode's webview microphone block.
- **Speech history.** Every transcription is saved with timestamp + language. One-click copy or delete per entry. Configurable TTL (1 day / 7 days / 30 days / forever).
- **In-panel settings.** Speech language, UI language, history TTL, Soniox model, recording shortcut, API key — all editable from the sidebar without leaving the editor.
- **Bilingual UI.** Hebrew (default) and English with automatic RTL/LTR layout.
- **Secure key storage.** `SONIOX_API_KEY` is held in VSCode `SecretStorage`, never in `settings.json`.
- **Append-only.** Never overwrites a selection, never auto-submits a chat message.
- **Diagnostics built-in.** Output channel logs every step; one command dumps environment + tool availability.

---

## Keyboard shortcuts

| Action | Default binding | Customize |
|---|---|---|
| Toggle recording | `Alt+M` (Linux/Win) · `Ctrl+Alt+M` (macOS) | Sidebar → Settings → **Recording shortcut → Change…** (opens the VSCode Keyboard Shortcuts editor pre-filtered for `voiceInput.toggleRecording`) |

The shortcut works **from any focus** — editor, chat input, terminal, and the Voice Input sidebar panel — and never moves your view. The transcription lands at the cursor (editor) or is pasted via simulated `Ctrl+V` (chat / other inputs).

**Trigger on key-up.** When the recording shortcut is pressed while the Voice Input sidebar panel has focus, the toggle fires on **key release** (not keydown). This prevents accidental double-triggers from key-repeat and matches the push-to-talk feel of the mic button. Your currently configured shortcut is displayed in the sidebar.

To change a binding by hand: `Ctrl+K Ctrl+S` → search `voiceInput.toggleRecording` → click the pencil → press your new combo.

---

## Platform support

| OS | Audio capture | Paste-key | Clipboard | Setup effort |
|---|---|---|---|---|
| **Linux Wayland** (GNOME/KDE/Sway) | `ffmpeg` (PulseAudio/PipeWire) | `ydotool` + system daemon | `wl-copy` | one-time daemon setup |
| **Linux X11** | `ffmpeg` (PulseAudio) | `xdotool` | `xclip` (or VSCode clipboard) | install packages |
| **macOS** | `ffmpeg` (avfoundation) | `osascript` (built-in) | `pbcopy` (built-in) | one Homebrew install |
| **Windows** | `ffmpeg` (DirectShow) | `powershell` SendKeys (built-in) | `clip.exe` (built-in) | install ffmpeg only |

The extension auto-detects the active platform and chooses the right backend at runtime — no per-platform config needed.

## Requirements

| Component | Why |
|---|---|
| **Soniox API key** | The STT backend. Get one at [soniox.com](https://soniox.com). Set via the sidebar **Set Soniox API key** button or `Voice Input: Set Soniox API Key`. |
| **`ffmpeg`** | Native microphone capture on every OS. Linux can also use `parecord` / `arecord`; macOS can also use `sox` / `rec`. |
| **`ydotool` + `ydotoold` daemon** (Linux Wayland) | Simulates `Ctrl+V` to paste into chat webviews. GNOME Wayland blocks `wtype`, so `ydotool` is the reliable choice. |
| **`wl-clipboard`** (Linux Wayland) | `wl-copy` writes directly to the Wayland clipboard, bypassing VSCode's clipboard sandbox latency. Strongly recommended on Wayland. |
| `wtype` / `xdotool` | Alternative paste-key tools auto-detected when present. |
| **`osascript`, `pbcopy`** (macOS) | Ship with macOS. Used for `Cmd+V` simulation and clipboard write — no install needed. |

### One-time setup on macOS

```bash
brew install ffmpeg
```

That's it. `osascript` and `pbcopy` come with macOS. After installing the extension, grant **VSCode** microphone access in **System Settings → Privacy & Security → Microphone** (the OS will prompt on first recording).

The recording shortcut on macOS is `Ctrl+Alt+M` (`Ctrl+Option+M`). Paste uses `Cmd+V` automatically.

### One-time setup on Linux Wayland (Ubuntu / Debian)

```bash
sudo apt install ffmpeg ydotool wl-clipboard

sudo tee /etc/systemd/system/ydotoold.service >/dev/null <<EOF
[Unit]
Description=ydotool daemon

[Service]
Type=simple
ExecStart=/usr/bin/ydotoold --socket-path=/tmp/.ydotool_socket --socket-own=$(id -u):$(id -g)
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ydotoold.service
```

The extension reads `/tmp/.ydotool_socket` automatically.

### One-time setup on Linux X11

```bash
sudo apt install ffmpeg xdotool xclip
```

### One-time setup on Windows

```powershell
winget install Gyan.FFmpeg
```

`powershell` and `clip.exe` ship with Windows. After install, restart your shell so `ffmpeg` is on PATH. The extension auto-detects the first DirectShow audio device; override with `voiceInput.audioDevice` in settings (e.g. `Microphone (Realtek)`). Find your device name with:

```powershell
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
```

---

## Quick start

1. Install the extension — `code --install-extension voice-input-*.vsix`.
2. Reload VSCode (`Developer: Reload Window`).
3. Open the **Voice Input** view in the activity bar (purple mic icon).
4. Click **Set Soniox API key** in the Settings section and paste your key.
5. Click into any chat input or editor.
6. Press **`Alt+M`** (Linux/Win) or **`Ctrl+Alt+M`** (macOS) to start recording — the status bar turns red.
7. Press the shortcut again — the transcript is pasted at the cursor and saved to history.
8. The Voice Input view shows the full history with copy / delete buttons.

---

## Settings

Configurable from both the in-panel **Settings** section (collapsible) and `settings.json`:

| Key | Values | Default |
|---|---|---|
| `voiceInput.languageHint` | `he`, `en`, `auto` | `he` |
| `voiceInput.uiLanguage` | `he`, `en` | `en` |
| `voiceInput.historyTtlDays` | `0` (forever), `1`, `7`, `30` | `30` |
| `voiceInput.sttModel` | Soniox model id | `stt-async-v4` |
| `voiceInput.injectionMode` | `auto`, `paste-key`, `type-key`, `editor-only`, `clipboard-only` | `auto` |

`auto` injection: text-file tab → editor cursor; everything else → clipboard + simulated `Ctrl+V`.

---

## Commands

All available from the Command Palette (`Ctrl+Shift+P`):

| Command | Default keybinding |
|---|---|
| `Voice Input: Toggle Recording` | `Alt+M` (Linux/Win) · `Ctrl+Alt+M` (macOS) |
| `Voice Input: Set Soniox API Key` | — |
| `Voice Input: Clear Soniox API Key` | — |
| `Voice Input: Clear History` | — |
| `Voice Input: Show Diagnostics` | — |

`Show Diagnostics` opens the Output panel and logs: extension version, session type (Wayland / X11), availability of `ffmpeg` / `ydotool` / `wl-copy`, and `ydotool` socket state. Use it whenever paste or recording misbehaves.

---

## Why two paths for injection?

VSCode webviews (used by Claude Code chat, etc.) are sandboxed and reject `getUserMedia` and any programmatic text injection from other extensions. The workaround is OS-level: capture audio via `ffmpeg` from the PulseAudio default source, then simulate a real `Ctrl+V` keystroke against the focused window so the chat input handles paste like any other clipboard event. Editors get the cleaner path via `vscode.TextEditor.edit`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Status bar says "no audio recorder found" | `ffmpeg` not on PATH | `sudo apt install ffmpeg` |
| Status bar says "paste failed" | `ydotoold` not running | `sudo systemctl status ydotoold` and re-enable per setup section |
| Random ASCII / `?` characters appear in chat instead of text | VSCode is running an old build of the extension | `Developer: Reload Window`; verify version with `Voice Input: Show Diagnostics` |
| Hebrew comes back as gibberish from Soniox | Wrong language hint | Set **Speech language** to `he` in the panel |
| Recording stops immediately | Default mic is a monitor source | `pactl get-default-source` — set a real input device |

---

## Changelog

### v1.0.5
- **Fix:** Added missing `icon` property to the microphone webview panel — resolves VSCode manifest validation warning.

### v1.0.4
- **Feat:** The hint text below the mic button ("or press … to toggle") now displays your **currently configured keyboard shortcut** dynamically. Changing the binding via the VSCode Keyboard Shortcuts editor is reflected immediately — no hardcoded `Alt+M` in the UI.
- macOS shows `Ctrl+Alt+M` by default; Linux/Win show `Alt+M`.

### v1.0.3
- **Fix:** Settings dropdowns no longer overflow the sidebar panel width at narrow sizes.

### v1.0.2
- **Fix:** `Alt+M` now works when the Voice Input sidebar panel has keyboard focus. Previously the keydown event was silently swallowed by the webview browser context with no handler, so the shortcut had no effect. A `keydown`/`keyup` listener pair is now registered in the webview — keydown suppresses the default action, keyup fires the toggle.
- **Behaviour:** When triggered from within the webview, the toggle fires on **key release** (`keyup`) rather than keydown, avoiding repeated triggers from key-repeat.

### v1.0.1
- Initial public release.
- Push-to-talk recording via `Alt+M` (editor / terminal focus only).
- Sidebar panel with transcription history, settings, and API key management.
- Linux Wayland / X11 / macOS / Windows support.
- Soniox STT backend with model and language selection.

---

## License

MIT.
