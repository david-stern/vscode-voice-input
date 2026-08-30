# Changelog

All notable changes to **Voice Input (Soniox STT)** are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Each version corresponds to a git tag of the form `vX.Y.Z`.

---

## [Unreleased]

### Added
- Bundled Picovoice PvRecorder targets for desktop VS Code on supported Linux, macOS, and Windows architectures; recording no longer requires `ffmpeg` or another external audio executable. Real microphone capture still requires validation on each target OS/architecture.
- Explicit **Toggle Assistant Listening** command and sidebar state with first-use modal consent stored in VS Code global state. Assistant listening never auto-starts and lasts only while VS Code is running.
- Local silence/speech segmentation, Hebrew/English wake phrases, a custom wake-phrase setting, and allowlisted actions for VS Code Chat, terminal, Voice Input settings, and stopping the session.
- `THIRD_PARTY_NOTICES.md` with Apache-2.0 attribution for Picovoice PvRecorder.

### Changed
- Microphone choices now use stable versioned identities; uniquely matching legacy device-name settings are migrated, while missing or ambiguous devices require explicit reselection.
- Assistant transcription is bounded to one request in flight and one queued utterance. Overflow, capture, and transcription errors stop listening and remain visible in the status bar.
- Push-to-talk and assistant listening are mutually exclusive. Native handles, request abort controllers, and renewal/safety timers are cancelled on stop and deactivation.
- Non-command assistant speech is append-only insertion/paste and never auto-submits. Exact Hebrew/Unicode paste is supported for Claude, ChatGPT, and Copilot inputs, but their sandboxed RTL DOM cannot be restyled by this extension.
- Device refresh uses explicit scans and a short cache instead of a Linux `/dev/snd/` watcher. Audio-executable dependency prompts and checks were removed; diagnostics now cover native enumeration and optional paste helpers.

### Privacy
- Soniox transcription and uploaded-file deletion are attempted after each request. Cleanup failures do not hide a successful transcript or replace the original transcription error.
- Audio and transcript content are excluded from extension logs.

## [1.0.7] — 2026-05-18

### Added
- Audio device dropdown + **Scan** button inside the sidebar Settings panel — lists all detected microphones and saves the selection immediately to `voiceInput.audioDevice`.
- New `audio-device-change` / `audio-device-scan` WebviewMessage types wired between the extension host and the webview.
- Linux `/dev/snd/` watcher now pushes updated device list to the webview on plug/unplug so the dropdown refreshes automatically.
- i18n keys: `settingsAudioDevice`, `audioDeviceDefault`, `audioDeviceScan` (Hebrew + English).
- `scripts/release.sh` — automated release script: build → sync docs → git commit + push → `vsce package`.
- `npm run publish` script in `package.json` that invokes `scripts/release.sh`.

### Changed
- `extension.ts`: `audioDevice` + `audioDevices` included in every `ViewState` push so the sidebar always shows the current selection.
- `package.json`: improved `voiceInput.audioDevice` setting description; version bumped to **1.0.7**.

---

## [1.0.6] — 2026-05-18

### Added
- **`Voice Input: Select Audio Device`** command — QuickPick listing every available microphone on the current platform; selection saved to `voiceInput.audioDevice`.
- `listAudioDevices()` helper: uses `pactl`/`arecord` on Linux, AVFoundation on macOS, DirectShow on Windows.
- **No-device guard**: blocks recording and offers a _Select Device_ button when no audio input is detected at recording time.
- **Dynamic device refresh**: `/dev/snd/` filesystem watcher on Linux for instant plug/unplug updates; 5-second cache TTL on macOS/Windows for near-real-time freshness.

### Changed
- `recorder/native.ts`: refactored to support per-device capture and dynamic device enumeration.
- README updated with new command docs, settings row, and troubleshooting entries.
- Version bumped to **1.0.6**.

---

## [1.0.5] — 2026-05-13

### Fixed
- Added missing `icon` property (`$(mic)` codicon) to the `voiceInput.micView` view declaration in `package.json` — resolves a VSCode manifest validation warning.

### Changed
- `package-lock.json` refreshed.
- Version bumped to **1.0.5**.

---

## [1.0.4] — 2026-05-13

### Added
- Sidebar now displays the user's **configured keyboard shortcut dynamically** (reads from VSCode keybindings at runtime) instead of a hardcoded "Alt+M" label.
- New `toToggle` i18n translation string; `mic.client.ts` builds the hint from `state.keybinding`.
- CSS styling for `hint-key` keyboard-format display.

### Changed
- Hardcoded `Alt+M` references removed from all i18n strings (Hebrew + English).
- README updated to clarify shortcuts are customizable and shown dynamically in the sidebar.
- Version bumped to **1.0.4**.

---

## [1.0.3] — 2026-05-13

### Fixed
- Settings `<select>` elements no longer overflow the sidebar panel width (`micView.ts` CSS fix).

### Changed
- Version bumped to **1.0.3**.

---

## [1.0.2] — 2026-05-13

### Fixed
- **Keyboard shortcut in webview focus context**: added `keydown` listener to suppress default browser behaviour and track Alt+M held state; `keyup` listener fires the toggle only on key release — prevents accidental double-triggers from key-repeat and matches the push-to-talk feel of the mic button.

### Changed
- Version bumped to **1.0.2**.

---

## [1.0.1] — 2026-05-13

### Added
- MIT `LICENSE` file.
- `repository` field added to `package.json` (GitHub URL).

### Changed
- Version bumped to **1.0.1**.

---

## [0.3.6] — 2026-05-13

### Added
- Platform install scripts: `scripts/install-linux.sh`, `scripts/install-mac.sh`, `scripts/install-windows.ps1`.
- **Auto dependency check on activation**: extension inspects the host OS for required tools (`ffmpeg`, `ydotool`/`xdotool`/`osascript`, clipboard utilities) and surfaces a diagnostic notification if any are missing.

### Changed
- Version bumped to **0.3.6**.

---

## [0.3.5] — 2026-05-13

### Added
- Initial release of **Voice Input (Soniox STT)**.
- **Push-to-talk recording** via `Alt+M` (Linux/Windows) / `Ctrl+Option+M` (macOS); customizable via the VSCode Keyboard Shortcuts editor.
- **Native audio capture** using `ffmpeg` (PulseAudio/PipeWire on Linux, avfoundation on macOS, DirectShow on Windows).
- **Soniox STT integration** — streams audio to the Soniox API and returns a transcription; configurable model (`voiceInput.sttModel`) and language hint (`voiceInput.languageHint`, default `he`).
- **Universal text injection**: editor → cursor insertion; chat webviews/panels → clipboard + simulated `Ctrl+V` via `ydotool` (Wayland) / `xdotool` (X11) / `osascript` (macOS) / PowerShell SendKeys (Windows).
- **Sidebar webview**: microphone panel with push-to-talk button, status indicator, speech history, and in-panel settings.
- **In-panel settings**: speech language, UI language, history TTL, Soniox model, recording shortcut, API key — all editable without leaving the editor.
- **Bilingual UI**: Hebrew (default) and English with automatic RTL/LTR layout switching.
- **Speech history**: every transcription saved with timestamp + language; configurable TTL (1 day / 7 days / 30 days / forever); one-click copy or delete per entry.
- **Secure API key storage**: `SONIOX_API_KEY` held in VSCode `SecretStorage`, never written to `settings.json`.
- **Diagnostics command**: `Voice Input: Show Diagnostics` dumps environment info and tool availability to the Output channel.
- `tsconfig.json`, `esbuild.js`, `.vscodeignore`, `.gitignore`, and full media assets (logo, icons, SVGs).
- Race condition fix: added delay before starting audio capture to avoid empty recordings on slow systems.
- macOS `Ctrl+Option+M` keybinding registered in `package.json` contributions.
