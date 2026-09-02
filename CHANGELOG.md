# Changelog

All notable changes to **Voice Input** are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Release packaging is local-only; this file does not assert that a version has been published.

## [Unreleased]

## [2.1.0] — 2026-09-02

### Added

- A singleton, serializer-backed Control Center with compatibility deep links from the retained launcher-only Settings view and a compact status/microphone sidebar.
- An exact 100-command bilingual built-in catalog with bounded overrides, typed executors, local VS Code Git API actions, 25-row pagination, and fail-closed remote Git availability.
- Host-owned Auto Mode with a native enable warning, machine/profile-local receipt and epoch, immediate status-bar kill switch, and context-bound invalidation. Auto skips only extension-owned confirmation; it does not bypass trust, finalized speech, validation, target revalidation, native Git prompts, cancellation, or unknown-outcome no-retry behavior.
- Provider-neutral speech contracts and an optional Soniox realtime WebSocket path. Realtime partials are display-only and only final text reaches wake, safety, matching, or planning; push-to-talk retains final-WAV asynchronous compatibility.

### Changed

- Fresh profiles now persist `voiceInput.transcriptionProvider=none`. Soniox requires explicit selection, a SecretStorage key, and a native machine-local remote-processing consent before speech networking. Upgrades with a locally detected legacy key preserve Soniox; uncertain legacy state remains locally repairable without a network lookup.
- Existing system speech settings are preserved on upgrade and remain available as a temporary, OS-dependent option. They are not a bundled local TTS implementation.

### Security, privacy, and evidence boundaries

- Selection, credential, consent, profile, trust, focus, target, and panel-generation changes invalidate the corresponding pending or active speech/action authority before delayed persistence can restore it.
- The Wave 1 package contains no local speech runtime, helper, model, weights, active model manifest, or downloader. The separate local-speech track remains pending; Soniox and system speech are not evidence that it is complete.
- The production WebSocket client is bundled from `ws` 8.21.3 with compression disabled and without its optional native acceleration packages.

## [2.0.0] — 2026-08-31

### Added

- Personal-agent foundation with six built-in templates: teacher/lecturer, secretary, friend, tour guide, mathematician, and philosopher. Agents can select a provider/model profile, be enabled/disabled, duplicated, deleted, and set as default through Settings.
- Eight optional planning-provider presets: DeepSeek, Anthropic Claude, OpenAI, Google Gemini, OpenRouter, Ollama, Amazon Bedrock API-key/bearer-token profile, and Grok/xAI. Profiles retain only non-secret endpoint, model, and enabled-state settings; credentials remain in VS Code SecretStorage.
- Provider credential management and a user-started, bounded, cancellable provider-connection test workflow.
- `voiceInput.assistantResumeOnStartup`, disabled by default. Startup resume is gated on prior consent, a configured Soniox credential, microphone readiness, and workspace trust; it never opens a prompt, setup wizard, or connection test.
- A bilingual Settings center for provider/model selection, agents, local system speech, actions and approvals, privacy, diagnostics, and recovery.

### Changed

- Voice Input is documented and presented as a personal voice assistant rather than a DeepSeek-only enhancement to push-to-talk.
- Provider-backed planning now uses an explicit provider selection and profiles. The old DeepSeek intelligence/model settings remain for migration compatibility.
- The permission boundary is explicit: answers and drafts are automatic after validation; send, command, tool, terminal, file-change, and external-state proposals require confirmation. Saved command/tool mappings are separately controlled and revalidated at execution.

### Security, privacy, and evidence boundaries

- Provider endpoints are constrained to provider allowlists; only loopback Ollama is treated as local. Remote providers receive only disclosed minimal planning fields and never receive screenshots, files/selections, clipboard data, terminal/chat history, mapping arguments, or tool input.
- Models cannot grant approval authority. Mapping and privileged agent execution fail closed when an agent, mapping, target, workspace-trust state, or authorization changes.
- Local capture continues to use bundled PvRecorder code and does not require `ffmpeg`.
- Third-party chat webviews remain manual-send. This release makes no arbitrary DOM focus, clicking, autofocus, or submission claim.
- Automated checks do not establish live cloud-provider behavior without user credentials, nor empirical Windows/macOS end-to-end behavior.

## [1.4.0] — 2026-08-31

### Added

- Dedicated bilingual **Settings** view beside the Microphone view, with accessible and RTL-safe General, Assistant, Providers & credentials, Speech, Microphone, Commands & tools, Privacy & trust, and Diagnostics sections.
- Explicit Soniox and optional DeepSeek key controls: Set, Replace, bounded cancellable Test connection, and Clear. Credential entry remains in a native password dialog; keys never enter webview state, settings, diagnostics, or logs.
- Assistant intelligence selector with **Off** and **DeepSeek**. Off prevents remote smart planning while preserving deterministic wake commands and safe local actions.
- Settings-native mapping management: visible phrases, public target ID, enabled state, and Agent exposure; native Add/Edit catalog wizard and confirmed Delete. Static command arguments and Language Model Tool input remain host-only.
- Sanitized Settings diagnostics with run, open, and copy actions; reports exclude secrets, transcripts, provider bodies, mapping inputs, usernames, and paths.

### Changed

- Reorganized the extension into typed configuration/credential services, provider probes, focused feature controllers, VS Code adapters, a shared webview protocol, and independent Microphone/Settings browser bundles. Existing command IDs, SecretStorage keys, mapping schema/opaque IDs, global-only mapping storage, and privacy boundaries remain compatible.
- Minimum supported VS Code version is **1.99.0**. The manifest contributes the Microphone and Settings views, `voiceInput.openSettings`, and the two Agent Mode tools.

### Security and compatibility

- Agent Mode tool calls use only locally approved mappings and VS Code's host invocation token; they do not need a separate Agent API key. DeepSeek's key is exclusively for optional intelligence.
- Only public VS Code commands and public Language Model Tools are selectable. Private or unexposed Claude, ChatGPT, Copilot, Codex, and MCP tools remain out of scope. Custom command/tool execution still fails closed in untrusted workspaces.

## [1.3.0] — 2026-08-30

### Added

- Native bilingual mapping manager for creating, editing, enabling, Agent-exposing, and deleting custom actions backed by currently registered public VS Code commands or public Language Model Tools.
- Exact local Hebrew/English phrase matching before DeepSeek planning, with one to eight phrases per mapping and bounded static JSON command arguments or tool input.
- A separate 12-second custom-action approval flow with spoken/visible target explanation, local confirmation phrases, matching sidebar buttons, focus-bound capabilities, timeout, replay protection, and lifecycle cancellation.
- Agent Mode tools `voice-input_listMappings` and `voice-input_runMapping`. The list tool returns all explicitly exposed opaque IDs, labels, and descriptions through bounded deterministic pages; the run tool accepts only one opaque mapping ID and uses VS Code host confirmation for the exact saved target.

### Security and compatibility

- Mappings are schema-validated and stored only in VS Code extension `globalState`. Workspace settings cannot inject actions.
- Internal and recursive targets, duplicate/reserved phrases, unsafe Unicode controls, prototype keys, templates, command URIs, excessive JSON depth/size, and unavailable targets are rejected.
- Every edit rotates the unpredictable mapping ID. Invocation re-resolves the ID and target, shares one voice/Agent single-flight guard, forwards Agent cancellation and tool-invocation context, discards target results, and fails closed in untrusted workspaces.
- If a command or nested tool rejects after dispatch begins, the assistant reports an explicit indeterminate, do-not-retry outcome so a possibly completed side effect is not repeated automatically.

## [1.2.0] — 2026-08-30

### Added

- Optional DeepSeek text planning with a separate privacy disclosure, API key stored only in VS Code SecretStorage, configurable model, strict JSON schema, finite timeout, and deterministic fallback when disabled.
- Six validated assistant personas: teacher/lecturer, secretary, friend, tour guide, mathematician, and philosopher. Replies explain the action and reason without claiming success before local execution.
- Selectable platform speech-synthesis voices, speaking-rate control, bounded FIFO speech, independent stop/disable controls, and bilingual spoken/visible feedback.
- Two-step built-in chat send flow: prepare a non-submitting partial query through the documented VS Code Chat command, then require a locally recognized distinct voice phrase or matching UI confirmation before using the documented submit command. DeepSeek cannot grant confirmation authority.

### Security and privacy

- Assistant execution is restricted to a closed local action allowlist. Model output cannot provide arbitrary VS Code commands, keys, DOM selectors, coordinates, or automatic submit instructions.
- DeepSeek receives only post-wake request text, validated persona, locale, and minimal target kind/focus metadata—never screenshots, documents, selections, clipboard content, terminal history, or chat history.
- Third-party chat webviews remain paste-only/manual-send because they expose no supported submit or DOM-control API.

## [1.1.0] — 2026-08-30

### Added

- Bundled Picovoice PvRecorder targets for desktop VS Code on supported Linux, macOS, and Windows architectures; recording no longer requires `ffmpeg` or another external audio executable. Real microphone capture still requires validation on each target OS/architecture.
- Explicit **Toggle Assistant Listening** command and sidebar state with first-use modal consent stored in VS Code global state.
- Local silence/speech segmentation, Hebrew/English wake phrases, a custom wake-phrase setting, and allowlisted actions for VS Code Chat, terminal, Voice Input settings, and stopping the session.
- `THIRD_PARTY_NOTICES.md` with Apache-2.0 attribution for Picovoice PvRecorder.

### Changed

- Microphone choices now use stable versioned identities; uniquely matching legacy device-name settings are migrated, while missing or ambiguous devices require explicit reselection.
- Assistant transcription is bounded to one request in flight and one queued utterance. Overflow, capture, and transcription errors stop listening and remain visible in the status bar.
- Push-to-talk and assistant listening are mutually exclusive. Native handles, request abort controllers, and renewal/safety timers are cancelled on stop and deactivation.
- Non-command assistant speech is append-only insertion/paste and never auto-submits. Exact Hebrew/Unicode paste is supported for Claude, ChatGPT, and Copilot inputs, but their sandboxed RTL DOM cannot be restyled by this extension.

## [1.0.7] — 2026-05-18

### Added

- Audio device dropdown and **Scan** button in the sidebar Settings panel, plus `Voice Input: Select Audio Device` for selecting a detected microphone.

## [1.0.0] — 2026-05-18

### Added

- Initial Soniox-based voice-to-text release with secure credential storage, transcription history, and configurable language/model settings.
