# Voice Input — Soniox STT for VSCode

Push-to-talk voice-to-text for desktop VS Code — code editors, GitHub Copilot Chat, Claude Code chat, ChatGPT chat, terminals, and settings forms. Audio is captured by the bundled Picovoice PvRecorder library, transcribed through the Soniox STT API, and inserted or pasted into the focused element. No `ffmpeg` installation is needed for capture.

Hebrew is the default language. The full UI is bilingual (he / en) with native RTL support.

---

## Features

- **Background recording.** Toggles recording from anywhere (default: `Alt+M` on Linux/Win, `Ctrl+Alt+M` on macOS) — customizable in sidebar, shows your configured shortcut dynamically.
- **Universal injection.** Editor → cursor insertion. Chat webviews / panels → clipboard + `Ctrl+V` simulated via `ydotool`. Works around VSCode's webview microphone block.
- **Audio device selection.** `Voice Input: Select Audio Device` lists every available microphone on the current platform and saves a stable identity to `voiceInput.audioDevice`. Use **Scan** to refresh after plugging or unplugging a device; the short-lived cache also refreshes within seconds.
- **Opt-in assistant listening.** Explicitly start an assistant session from the sidebar or Command Palette. Local silence detection sends only completed speech segments to Soniox, requires one-time modal consent, and stops when VS Code closes. It never starts automatically and never submits a chat message.
- **Safe wake actions.** After a Hebrew or English wake phrase, the assistant can open VS Code Chat, toggle the terminal, open Voice Input settings, or stop listening. Any other post-wake text is append-only insertion/paste.
- **No-device guard.** If no audio input source is detected when you try to start a recording, the extension blocks the attempt and offers a **Select Device** button instead of surfacing a cryptic recorder error.
- **Speech history.** Every transcription is saved with timestamp + language. One-click copy or delete per entry. Configurable TTL (1 day / 7 days / 30 days / forever).
- **In-panel settings.** Speech language, UI language, history TTL, Soniox model, recording shortcut, API key — all editable from the sidebar without leaving the editor.
- **Bilingual UI.** Hebrew (default) and English with automatic RTL/LTR layout.
- **Secure key storage.** `SONIOX_API_KEY` is held in VSCode `SecretStorage`, never in `settings.json`.
- **Append-only.** Never overwrites a selection, never auto-submits a chat message.
- **Diagnostics built-in.** Output channel reports environment, native device enumeration, and paste-helper availability without logging audio or transcript content.

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
| **Linux Wayland** (GNOME/KDE/Sway) | bundled PvRecorder target | `ydotool` + system daemon | `wl-copy` | paste helpers only |
| **Linux X11** | bundled PvRecorder target | `xdotool` | VS Code clipboard | paste helper only |
| **macOS** | bundled PvRecorder target | `osascript` (built-in) | `pbcopy` (built-in) | grant microphone permission |
| **Windows** | bundled PvRecorder target | PowerShell SendKeys (built-in) | VS Code clipboard | grant microphone permission |

This is a desktop VS Code extension. Browser-hosted VS Code, `vscode.dev`, and Codespaces web extension hosts are not supported. In Remote/SSH/WSL windows the UI extension runs locally and uses the desktop microphone.

The package contains recorder targets for supported Linux, macOS, and Windows architectures. The automated checks in this repository do not replace real microphone-permission, capture, and exact-paste validation on every OS/architecture.

## Requirements

| Component | Why |
|---|---|
| **Soniox API key** | The STT backend. Get one at [soniox.com](https://soniox.com). Set via the sidebar **Set Soniox API key** button or `Voice Input: Set Soniox API Key`. |
| **`ydotool` + `ydotoold` daemon** (Linux Wayland) | Simulates `Ctrl+V` to paste into chat webviews. GNOME Wayland blocks `wtype`, so `ydotool` is the reliable choice. |
| **`wl-clipboard`** (Linux Wayland) | `wl-copy` writes directly to the Wayland clipboard, bypassing VSCode's clipboard sandbox latency. Strongly recommended on Wayland. |
| `wtype` / `xdotool` | Alternative paste-key tools auto-detected when present. |
| **`osascript`, `pbcopy`** (macOS) | Ship with macOS. Used for `Cmd+V` simulation and clipboard write — no install needed. |

### One-time setup on macOS

After installing the extension, grant **VS Code** microphone access in **System Settings → Privacy & Security → Microphone** (the OS will prompt on first recording). `osascript` and `pbcopy` come with macOS.

The recording shortcut on macOS is `Ctrl+Alt+M` (`Ctrl+Option+M`). Paste uses `Cmd+V` automatically.

### One-time setup on Linux Wayland (Ubuntu / Debian)

```bash
sudo apt install ydotool wl-clipboard

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
sudo apt install xdotool
```

### One-time setup on Windows

Grant desktop VS Code microphone permission when Windows prompts. PowerShell ships with Windows; no audio-capture executable is required.

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

For assistant listening, use **Voice Input: Toggle Assistant Listening** or the sidebar control. The first start shows a modal disclosure. Listening remains active only while desktop VS Code is running and only after that explicit start; reloading or reopening VS Code does not restart it. Say a built-in Hebrew/English wake phrase (or configure your own) before a safe action or text to paste.

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
| `voiceInput.audioDevice` | Device id (see **Select Audio Device**) or `""` for system default | `""` |
| `voiceInput.assistantWakePhrase` | Custom phrase, or `""` for the built-in Hebrew/English phrases | `""` |

To pick a device interactively run **`Voice Input: Select Audio Device`** from the Command Palette — it enumerates all available inputs and writes the chosen id to `voiceInput.audioDevice` automatically.

`auto` injection: text-file tab → editor cursor; everything else → clipboard + simulated `Ctrl+V`.

---

## Commands

All available from the Command Palette (`Ctrl+Shift+P`):

| Command | Default keybinding |
|---|---|
| `Voice Input: Toggle Recording` | `Alt+M` (Linux/Win) · `Ctrl+Alt+M` (macOS) |
| `Voice Input: Toggle Assistant Listening` | — |
| `Voice Input: Select Audio Device` | — |
| `Voice Input: Set Soniox API Key` | — |
| `Voice Input: Clear Soniox API Key` | — |
| `Voice Input: Clear History` | — |
| `Voice Input: Show Diagnostics` | — |

`Show Diagnostics` opens the Output panel and logs the extension version, desktop session, native microphone count, paste-helper availability, and `ydotool` socket state. It does not log audio or transcript content.

---

## Why two paths for injection?

VS Code webviews used by Claude, ChatGPT, and GitHub Copilot are sandboxed from other extensions. Voice Input captures through its bundled native recorder, preserves the exact Hebrew/Unicode text on the clipboard, and simulates a normal paste into the focused vendor input. It never presses Enter. Editors use the supported `vscode.TextEditor.edit` path.

The Voice Input sidebar can render its own transcript history with automatic RTL/LTR direction. VS Code does not expose supported APIs for restyling the sandboxed DOM owned by Claude, ChatGPT, or Copilot, so this extension can guarantee exact Hebrew paste but cannot force those vendors' chat inputs or messages to adopt RTL styling.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Status bar says the bundled recorder could not load | Unsupported/incorrect native package in the installed VSIX | Reinstall the extension package for your desktop OS/architecture and run **Show Diagnostics**. |
| Status bar says "paste failed" | `ydotoold` not running | `sudo systemctl status ydotoold` and re-enable per setup section |
| Random ASCII / `?` characters appear in chat instead of text | VSCode is running an old build of the extension | `Developer: Reload Window`; verify version with `Voice Input: Show Diagnostics` |
| Hebrew comes back as gibberish from Soniox | Wrong language hint | Set **Speech language** to `he` in the panel |
| Recording stops immediately | Selected microphone is unavailable or permission was denied | Grant desktop VS Code microphone permission, then run `Voice Input: Select Audio Device`. |
| "No audio input source found" when pressing `Alt+M` | No microphone connected or detected | Plug in a microphone, then run `Voice Input: Select Audio Device` |

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full history.

### Version 1.1.0
- **Audio:** Bundled Picovoice PvRecorder capture replaces external audio-recording executables; desktop VS Code uses the local microphone and no longer needs `ffmpeg` for capture.
- **Assistant:** Explicit, consented listening sessions with local speech segmentation, bounded transcription work, allowlisted VS Code actions, wake phrases, visible state, and no chat auto-submit.
- **Privacy/RTL:** Best-effort Soniox remote cleanup, content-free diagnostics, exact Unicode paste, and clearer sandboxed vendor-webview limits.

---

## License

MIT.
