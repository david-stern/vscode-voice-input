# Voice Input — personal voice assistant for VS Code

Voice Input 2.1 combines microphone capture, opt-in Soniox speech-to-text, optional provider-backed planning, bounded personal agents, and OS-dependent system speech. Its canonical interface is a singleton full-editor Control Center with a compact Activity Bar microphone/status launcher. It supports Hebrew and English, including RTL-safe extension views and Unicode-preserving insertion. A fresh installation has no transcription provider selected and performs no speech-network request until Soniox is explicitly selected, configured, and consented to.

It is a personal assistant inside VS Code—not a browser-automation tool. It does not inspect another chat's DOM, autofocus arbitrary controls, click buttons, or submit messages to third-party chat surfaces.

## What it does

- **Opt-in Soniox STT.** Audio is captured with bundled Picovoice PvRecorder code. Soniox is used only after explicit provider selection, a key in VS Code SecretStorage, and a machine/profile-local native consent for remote audio processing. Capture has no `ffmpeg` dependency or other external audio executable requirement.
- **Push-to-talk and opt-in listening.** Push-to-talk retains final-WAV asynchronous transcription compatibility. Assistant listening uses realtime PCM; partial text is display-only, and only a finalized utterance may reach the wake phrase, safety checks, matcher, or planner.
- **Eight assistant-provider presets.** DeepSeek, Anthropic Claude, OpenAI, Google Gemini, OpenRouter, Ollama, Amazon Bedrock (API-key/bearer-token profile), and Grok/xAI are available for optional planning. You select a provider, endpoint profile, and model; credentials stay in VS Code SecretStorage.
- **Six built-in personas.** Teacher/lecturer, secretary, friend, tour guide, mathematician, and philosopher are available as bounded agent templates.
- **System speech (temporary and OS-dependent).** Replies can use voices exposed to the webview by the operating system. Availability and quality depend on the installed OS voices; this is not a bundled local TTS engine.
- **Control Center and compact sidebar.** One singleton full-editor Control Center owns setup, Voice, Commands, Assistant, Privacy, Diagnostics, and recovery. The Activity Bar surfaces are compact launchers; the compatibility Settings view and command deep-link into that same Control Center.
- **Exactly 100 built-in commands.** The built-in catalog is bilingual, paginated, editable through bounded presentation overrides, and executed through typed VS Code/Git adapters before custom mappings or provider planning. All Git actions are unavailable in remote VS Code environments.
- **Host-owned Auto Mode.** Auto can skip only the extension's own action confirmation after an explicit native warning creates a machine-local receipt. It never bypasses wake/finalization, validation, workspace trust, target revalidation, native Git prompts, cancellation, or unknown-outcome no-retry rules. The status-bar kill switch disables it immediately.
- **Mappings and agents.** Create exact phrase mappings to registered public VS Code commands or public language-model tools. Agent exposure, target checks, workspace trust, and approvals stay enforced by the extension host.
- **Privacy-aware Hebrew/RTL UI.** The extension's Microphone and Settings views support Hebrew and English with appropriate RTL/LTR rendering. It preserves Hebrew/Unicode when it can insert or paste text, but cannot restyle another extension's sandboxed chat DOM.

## Install and first setup

1. Install a locally built VSIX: `code --install-extension voice-input-*.vsix`.
2. Open **Voice Input** from the activity bar, then open the **Control Center**. **Voice Input: Open Settings** remains a compatibility launcher to the same singleton panel.
3. In **Voice**, either leave transcription unconfigured or explicitly choose **Soniox**. Enter the key in the native password dialog and separately accept the native remote-processing disclosure. The key is not written to `settings.json`, and provider selection alone makes no request.
4. In **Microphone**, choose the system default or a detected device. Grant desktop VS Code microphone permission if your operating system requests it.
5. Use **Test connection** only when you have deliberately configured the relevant credential. A test is user-started, bounded, cancellable, and reports a sanitized result category.
6. Start with **Toggle Recording**, or explicitly enable **Assistant listening** after reading and accepting its disclosure.

The guided Control Center flow can also check configuration readiness and run a harmless rehearsal. It does not bypass consent or execute an external action as part of setup. The local STT/TTS track remains pending. This release contains no model, weight, runtime, manifest, or downloader for that track.

### Recording controls

| Control | Default |
|---|---|
| Toggle recording | `Alt+M` on Linux/Windows; `Ctrl+Alt+M` on macOS |
| Toggle assistant listening | No default keybinding |
| Select audio device | `Voice Input: Select Audio Device` |

Change the recording shortcut through the Settings view or VS Code Keyboard Shortcuts (`Ctrl+K Ctrl+S`), searching for `voiceInput.toggleRecording`.

## Assistant providers, models, and agents

Open **Control Center → Assistant & Providers** to select the planning provider, configure its model and permitted endpoint profile, then set, replace, or clear its credential from the native credential flow. Provider configuration never starts listening or sends a request by itself.

| Preset | Default locality and credential behavior |
|---|---|
| DeepSeek | Remote; API key required |
| Anthropic Claude | Remote; API key required |
| OpenAI | Remote; API key required |
| Google Gemini | Remote; API key required |
| OpenRouter | Remote; API key required |
| Ollama | Local only when its endpoint is loopback (default `127.0.0.1`); key optional |
| Amazon Bedrock | Remote API-key/bearer-token profile; credential required |
| Grok/xAI | Remote; API key required |

The preset endpoints are allowlisted by provider. Only Ollama may use an HTTP loopback endpoint; non-loopback profiles are treated as remote. The default models are editable presets, not a claim that any model is currently available to your account.

In **Control Center → Assistant & Providers**, create an agent from one of the six built-in templates, select its provider and model, choose the default agent, enable or disable it, duplicate it, or delete it. Agent instructions are validated and stored by the extension host rather than exposed as raw webview content. A configured agent still has no authority to send text or run an action without the permission checks below.

The legacy `voiceInput.assistantIntelligence` and `voiceInput.deepSeekModel` settings remain only for migration. New setup should use `voiceInput.assistantProvider` and `voiceInput.providerProfiles` or the Settings view.

## Speech, listening, and background resume

**System speech is a temporary, OS-dependent path.** It uses voices the operating system exposes through the webview speech API. In **Voice**, select a voice URI, set a rate from 0.5 to 2, play a test phrase, stop speech, or disable it. A missing OS voice is reported as unavailable and never triggers a fallback you did not select. On Linux, where the editor's webview often exposes no OS voice at all, the host additionally offers one `speech-dispatcher` voice when the `spd-say` probe succeeds.

**Soniox voices are an opt-in remote speech-output path.** They appear in the same **Voice** voice list, prefixed with `Soniox`, only while all of these hold:

- Soniox is the explicitly selected transcription provider;
- a Soniox key is stored in VS Code SecretStorage;
- the machine/profile-local Soniox remote-processing consent is still valid.

Speaking through such a voice sends the reply text to Soniox under that same consent, exactly as transcription sends audio, and plays the returned audio through `paplay` or `aplay`. The text and the audio are never written to a temporary file, never passed on a command line, and never logged. Selecting a Soniox voice while its consent, key, or provider selection has lapsed is not an error: the reply falls back to `speech-dispatcher`, then to the sidebar voice. Revoking the consent, rotating the key, or choosing another provider removes those voices again.

Soniox bills generated speech audio separately from transcription, so previews and spoken replies through a Soniox voice consume your Soniox budget. Leave the voice list on an OS voice — or leave speech off — if you do not want that.

**Listening is opt-in.** The normal path is an explicit start and a first-use disclosure. `voiceInput.assistantResumeOnStartup` is `false` by default. If you explicitly enable it in native VS Code Settings, the extension may resume listening after startup only when all of these are already true:

- assistant-listening consent was previously acknowledged;
- Soniox is still explicitly selected and its machine-local remote-processing consent remains valid;
- a Soniox credential is configured;
- a usable, non-stale microphone selection is available;
- the workspace is trusted.

Startup resume never opens a credential prompt, disclosure, setup wizard, or connection test. If any gate is unavailable, it fails closed and leaves listening stopped.

## Permissions and mapping approvals

The extension host—not a model response—decides whether an action is allowed.

- **Automatic:** answers and drafts can be authorized after validation.
- **Confirmation required:** send, command, tool, terminal, file-change, and external-state proposals need a later, distinct confirmation and are tied to the active agent, provider, model, target snapshot, and short-lived authorization.
- **Saved mapping approval:** a command/tool mapping must be explicitly created from currently registered public VS Code targets. You can expose it to Agent Mode and grant or revoke its saved approval. The exact saved mapping is still revalidated before dispatch; changed, disabled, unavailable, or untrusted targets fail closed.

Use **Control Center → Commands** or **Voice Input: Manage Custom Voice Actions** to manage phrase mappings. Built-ins resolve before custom mappings and provider planning. Mappings accept bounded static JSON only, live in extension global storage rather than workspace settings, and are blocked from privileged execution in untrusted workspaces.

The extension has no arbitrary third-party-chat autofocus or submit capability. It can prepare a non-submitting draft through VS Code's documented built-in Chat route, subject to local confirmation. Claude, ChatGPT, Codex, Copilot, and other third-party webviews remain manually sent by the user.

## Data boundaries

- Soniox receives audio only after explicit selection, a configured key, and a current machine/profile-local remote-processing consent. Changing selection, credential, profile, or consent invalidates active speech authority and closes the current session.
- A selected remote planning provider receives only the post-wake request, persona and bounded agent instructions, locale, and minimal target kind/focus metadata.
- Planning providers do **not** receive screenshots, files or selections, clipboard data, terminal or chat history, mapping arguments, or tool input.
- A loopback Ollama profile is the only planning profile described as local. All other presets are remote.
- Credentials are held in VS Code SecretStorage, never in provider profiles, webview state, diagnostics, or normal logs.
- Diagnostics intentionally exclude keys, transcripts, provider bodies, mapping input, usernames, and paths.

## Settings reference

| Key | Purpose | Default |
|---|---|---|
| `voiceInput.languageHint` | Soniox language hint: `he`, `en`, or `auto` | `he` |
| `voiceInput.uiLanguage` | Extension UI language: `he` or `en` | `en` |
| `voiceInput.audioDevice` | Selected input ID; empty uses the system default | `""` |
| `voiceInput.assistantWakePhrase` | Custom wake phrase; empty uses the built-in Hebrew/English phrases | `""` |
| `voiceInput.assistantResumeOnStartup` | Resume listening only through the gated startup path | `false` |
| `voiceInput.assistantProvider` | `off` or one of the eight planning presets | `deepseek` |
| `voiceInput.providerProfiles` | Non-secret endpoint, model, and enabled-state profiles | Built-in profiles |
| `voiceInput.assistantPersona` | Legacy persona migration setting | `teacher-lecturer` |
| `voiceInput.assistantSpeechEnabled` | Enable temporary, OS-dependent system speech | `true` |
| `voiceInput.assistantSpeechVoiceUri` | Selected speech voice: an OS voice URI, `voice-input-host:speech-dispatcher`, or `voice-input-soniox:<VoiceId>` | `""` |
| `voiceInput.assistantSpeechRate` | Speech rate | `1` |
| `voiceInput.transcriptionProvider` | `none`, `soniox`, or migration-only `legacy-soniox-pending` | `none` |
| `voiceInput.autoMode` | Requested/display state; effective Auto also requires the machine-local native-confirmation receipt | `false` |
| `voiceInput.historyTtlDays` | Transcript history retention | `30` |
| `voiceInput.sttModel` | Soniox model identifier | `stt-async-v4` |
| `voiceInput.injectionMode` | `auto`, paste/type key, editor-only, or clipboard-only insertion policy | `auto` |

Never put an API key, bearer token, or secret in `voiceInput.providerProfiles`.

## Commands

| Command |
|---|
| `Voice Input: Open Control Center` |
| `Voice Input: Disable Auto Mode` |
| `Voice Input: Toggle Recording` |
| `Voice Input: Toggle Assistant Listening` |
| `Voice Input: Open Settings` |
| `Voice Input: Manage Custom Voice Actions` |
| `Voice Input: Select Audio Device` |
| `Voice Input: Manage Assistant Provider Credentials` |
| `Voice Input: Test Assistant Provider Connection` |
| `Voice Input: Set Soniox API Key` / `Clear Soniox API Key` |
| `Voice Input: Clear History` |
| `Voice Input: Show Diagnostics` |

## Recovery and platform notes

| Problem | Recovery |
|---|---|
| No microphone or recording stops | Check desktop VS Code microphone permission, then run **Select Audio Device** and choose a currently available device. |
| Soniox is not ready | Verify explicit provider selection, native remote consent, and credential; then deliberately run its connection test. |
| Startup did not resume listening | Confirm `assistantResumeOnStartup` is enabled and every startup gate above remains true; otherwise start listening explicitly. |
| Speech has no desired voice | Install or enable a system voice, reopen the Voice Input view, then select it again. On Linux, `speech-dispatcher` (`spd-say`) and, with Soniox selected and consented, the `Soniox` voices are offered as well. |
| A Soniox voice is silent | Confirm the Soniox key, the remote-processing consent, and that `paplay` or `aplay` exists on the machine. The reply still falls back to `speech-dispatcher` or the sidebar voice. |
| Hebrew is wrong or unreadable | Set the Soniox hint to `he`, use the extension's Hebrew UI if desired, and prefer paste-oriented insertion for external controls. |
| A chat did not submit | This is expected for third-party chat webviews. Review the pasted/drafted text and send it yourself. |

Windows is a supported desktop target in the packaged native-recorder set, and the default recording shortcut includes Windows. That is not an empirical compatibility claim for a particular Windows installation, microphone, editor focus target, or speech voice. The same caution applies to macOS: platform code and packaging coverage are not substitute for tested hardware/permission behavior on your machine.

## Evidence limits for 2.1.0

- No `ffmpeg` dependency is required for bundled capture.
- The package contains no local speech model, weight, runtime, model manifest, or downloader; local speech remains a separate pending track.
- System speech checks are OS-dependent and are not evidence of bundled local TTS.
- Automated repository checks can exercise host logic and webview structure, but they do not validate a live cloud-provider account without user-supplied credentials.
- This release does not claim empirical end-to-end verification on Windows or macOS hardware.
- It does not claim arbitrary third-party-chat focus, DOM control, or automatic message submission.

## Changelog and license

See [CHANGELOG.md](CHANGELOG.md) for release history. Licensed under [MIT](LICENSE).
