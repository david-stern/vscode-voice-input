# Control Center protocol and state matrix

**Status:** frozen for Wave 1 implementation

**Trust boundary:** the Extension Host owns state, network, secrets, authority, and dispatch; webviews own presentation and user intents only.

## 1. Panel lifecycle and singleton protocol

The host owns one serialized controller per Extension Host and one reference to `voiceInput.controlCenter`.

| Event | Host behavior | Webview behavior | Invariant |
|---|---|---|---|
| `createOrShow(route?, params?)`, no panel | Create in active editor column with strict options, allocate revision, queue valid explicit deep link | Load static packaged document and send `ready` | One panel reference |
| `createOrShow`, panel exists | `reveal()` canonical panel; latest valid explicit deep link replaces older queued explicit links | Wait for host snapshot | No second panel |
| Generic open while explicit deep link queued | Reveal only; do not overwrite queued explicit target | No navigation assumption | Latest explicit wins |
| Serializer restoration | Pass restored panel to the same serialized `adoptOrCreate` controller | Browser state is a hint only | Host state remains authoritative |
| Serializer/command race | First adopted panel remains canonical; dispose duplicate; apply latest explicit deep link to canonical panel | Duplicate must not dispatch or ack | Deterministic dedup |
| Hide/reveal | Keep host operation state; because `retainContextWhenHidden=false`, send a fresh snapshot after new `ready` | Rebuild DOM from snapshot | DOM persistence is never assumed |
| Reload | Keep bounded host display state; discard overlay and pending browser intents | Send `ready(lastAppliedRevision)` | No replay of actions |
| Panel dispose | Clear listeners, timers, message subscriptions, focus-return handles, handshake queue, and singleton reference | Stop DOM work | Host Soniox session, pending action, and authority are neither cancelled nor duplicated |
| Extension deactivate | Close host-owned resources using their own contracts; dispose panel/controller | No final authority message | No orphan UI callback |

Required panel options are exact: `enableScripts:true`, `enableCommandUris:false`, `retainContextWhenHidden:false`, and `localResourceRoots` containing only packaged Control Center assets. All assets use `asWebviewUri`. Soniox networking remains host-side.

## 2. Host-owned display snapshot

Only this bounded, non-sensitive display state may be persisted in `workspaceState`:

```text
route: home | voice | commands | assistant | privacy | diagnostics
filter?: <= 200 Unicode code points
page?: integer 1..4
```

`commandId` and `setupStep` are transient, validated host/deep-link projections for the current revision only; they are never written to `workspaceState` and disappear on reload/restart unless a new explicit deep link supplies them. Language and direction are derived from authoritative configuration for each emitted snapshot; they are not part of persisted Control Center display state.

The persisted object must not contain `commandId`, `setupStep`, language/direction, an overlay, modal kind, drawer kind, pending-review target, secret, consent receipt, Auto receipt/nonce/epoch, pending authorization, action outcome, transcript audio, private filesystem path, Soniox key, or dispatch request. `webview.setState` is allowed only as a non-authoritative bootstrap hint and is always validated and replaced by host state.

The host may add bounded transient projections to an in-memory `stateSnapshot`: configured language/direction, capabilities, a validated setup step, a known built-in `commandId`, or the fixed semantic focus target `pending-custom-review`. These values are display/focus context only, are never browser-authored authority, and are never persisted by the Control Center.

Explicit setup-choice evidence is a separate host configuration record, not Control Center display persistence. Its global-state key is `voiceInput.controlCenterSetupChoices.v1` and its only accepted closed value is `{ schemaVersion:1, stt, tts }`, where `stt` is `pending|none|soniox` and `tts` is `pending|off|system`. Unknown/extra fields, a non-plain prototype, wrong version, or invalid enum reset the interpreted record to both choices `pending`. Existing provider/TTS intents update this marker only after host validation. It contains no secret, consent result, review result, authority, receipt, nonce, target, or action outcome; it is never sent directly to the browser and cannot enable Auto or dispatch an action.

## 3. Revision handshake

```text
webview -> host: ready(lastAppliedRevision)
host -> webview: stateSnapshot(revision, state, capabilities, focusTarget?)
webview: validate -> render -> update title/aria-current/H1 -> focus
webview -> host: ack(revision)
```

- `revision` is a host-owned monotonically increasing safe integer for the panel lifecycle.
- The host rejects duplicate intents and any intent carrying a revision this panel attachment never delivered; a new attachment starts with no acceptable revision.
- Acceptance is two-tier, because the host republishes on every host-side state change and a click posted between a publish and its render would otherwise be lost. Navigation, presentation, observation, local-device, and read-only detail intents are accepted on any of the last eight delivered revisions. Authority, credential, provider, agent, custom-command, command-mutation, and pending-review intents require the current delivered revision and are otherwise rejected as strictly stale.
- The webview ignores stale/duplicate snapshots and never acks before render and focus complete.
- A valid explicit deep link receives a new revision. Before readiness, only the latest explicit deep link is retained; a generic open does not erase it.
- Focus-return targets are semantic IDs from an allowlist, not selectors or HTML supplied by the browser.
- A missing/removed target falls back in order to the stable command row, route H1, then `main` heading. Focus never falls to `body`.

## 4. Allowed message families

Every object is closed: fields not listed for its type are rejected. Every `revision`, `lastAppliedRevision`, `requestSequence`, and transcript sequence described as safe is an integer `0..Number.MAX_SAFE_INTEGER`. `r` means the current applied revision and is required on every browser intent that can mutate display, configuration, capture, overlay, authority, review, or command state; every host message carries a host-owned safe-integer revision.

### Browser to host schemas

| Type | Exact fields and bounds | Authority rule |
|---|---|---|
| `ready` | `{ type, lastAppliedRevision }`; revision is `null` or safe integer `0..MAX_SAFE_INTEGER` | Handshake only |
| `ack` | `{ type, revision }`; safe integer matching the last fully rendered/focused snapshot | Handshake only |
| `navigateIntent` | `{ type, revision:r, route, params? }`; route is one of six; params uses the closed schema below | Host validates and allocates a new revision |
| `setFilterIntent` | `{ type, revision:r, filter }`; string `0..200` Unicode code points | Host persists only validated filter |
| `setPageIntent` | `{ type, revision:r, page }`; integer `1..4` | Host persists only validated page |
| `openPendingReviewIntent` | `{ type, revision:r }` only | Payload-free; host resolves current pending action |
| `pendingReviewIntent` | `{ type, revision:r, decision }`; decision is `request-native-confirmation|cancel` | No pending ID/token/outcome; host re-resolves current pending state |
| `openOverlayIntent` | `{ type, revision:r, kind }`; kind is `command-details|provider-details|narrow-nav|auto-explanation|action-preview` | Ephemeral request only |
| `closeOverlayIntent` | `{ type, revision:r, reason }`; reason is `close|escape|cancel|save` | `save` is not approval/dispatch |
| `requestAutoEnableIntent` | `{ type, revision:r }` only | Requests host-owned native prompt; grants nothing |
| `disableAutoIntent` | `{ type, revision:r }` only | Host immediately invalidates effective receipt/epoch |
| `providerSetupIntent` | `{ type, revision:r, provider, request }`; provider is `none|soniox`; request is `select|configure-secret|request-remote-consent|test|revoke` | Browser cannot carry secret, consent result, endpoint, receipt, or profile ID |
| `micIntent` | `{ type, revision:r, action }`; action is `start|stop|test` | Host gates provider, consent, credential, device, trust, and session |
| `microphoneSetupIntent` | `{ type, revision:r, operation }`; operation is `select-device|test-signal|stop-test` | Enumeration is not proof; only the host's bounded non-zero-signal observation changes readiness |
| `systemTtsVoicesObservedIntent` | `{ type, revision:r, voices }`; array `0..20` of unique `voiceUri` rows; each exact row is `{ voiceUri, name, language, isDefault }`, with URI `1..512`, name `1..120`, language `0..40` code points, and boolean default | Browser capability evidence only. Host maps an index against the current same-revision bounded list; voice observations never grant action authority |
| `systemTtsIntent` | Exactly one of `{ type, revision:r, operation:'set-enabled', enabled }`, `{ type, revision:r, operation:'set-voice', voiceIndex }`, or `{ type, revision:r, operation:'set-rate', rate }`; boolean enabled, integer voice index `-1..19`, finite rate `0.5..2` | Configuration/presentation only; no executor, consent, receipt, or authority field |
| `commandEditIntent` | Exactly one of: `open` with `{ type, revision:r, commandId, operation, requestSequence }`; `set-enabled` with boolean `value`; `replace-phrases` with phrase-list `value`; or `reset` with no extra field. `commandId` is a known built-in ID; `requestSequence` is a safe integer; a phrase list has `1..20` unique strings, each `1..120` code points and `<=1200` total | Re-enabling does not reset phrases. Executor ID and slot schema are never accepted; request sequence is correlation, not authority |
| `setManagementPageIntent` | `{ type, revision:r, target, page }`; `agents` page `1..4`, or `custom-commands` page `1..5` | Presentation pagination only |
| `planningProviderIntent` | `provider` is `off|deepseek|anthropic|openai|gemini|openrouter|ollama|bedrock|grok`. `save-profile` is exactly `{ type, revision:r, provider, operation, enabled, model }`, forbids `off`, uses boolean enabled and the model pattern below. Every other operation is exactly `{ type, revision:r, provider, operation }`, where operation is `select|set-credential|replace-credential|clear-credential|test|cancel-test|review-consent|revoke-consent`; `off` permits only `select` | Credential operations open host/native UI; no secret or native result enters the DOM message |
| `agentManagementIntent` | Exactly: `create` + a template ID; `update-profile` + agent ID, provider ID, model; `set-enabled` + agent ID and boolean; or `set-default|duplicate|delete` + agent ID. Templates are `teacher-lecturer|secretary|friend|tour-guide|mathematician|philosopher` | Profile management only; instructions, prompt text, credentials, confirmation, and authority are not accepted |
| `customCommandIntent` | Exactly: `open` + custom ID + safe-integer `requestSequence`; `add` + draft; `edit` + custom ID + draft; `set-enabled` + custom ID + boolean; or `delete` + custom ID. The exact draft schema and bounds are below | Friendly bounded fields only; no raw JSON, arguments, executor object, pending ID, result, or approval |
| `diagnosticsIntent` | `{ type, revision:r, operation, requestSequence }`; operation is `run|open|copy`, sequence is a safe integer | Payload-free operation request; diagnostics results are host-projected and cannot be browser-authored |

Closed `navigateIntent.params` permits at most four own properties: `filter` (`0..200` code points), `page` (integer `1..4`), `commandId` (known built-in ID, `1..80` printable non-space ASCII characters), and `setupStep` (integer `1..4`). The latter two are transient and never persisted. An omitted params object is equivalent to an empty null-prototype record.

Shared management field bounds are exact:

- model IDs match `[A-Za-z0-9~][A-Za-z0-9._~:/@+-]{0,255}`;
- agent IDs match `agent_[A-Za-z0-9_-]{12,80}`;
- custom-command IDs match `vm_[A-Za-z0-9_-]{22,64}`;
- target IDs are `1..256` non-whitespace characters;
- a custom-command draft is `{ label, description, phrases, kind, targetId, enabled, agentEnabled }`: label `1..80`, description `0..240`, the shared bounded phrase list, kind `command|language-model-tool`, target ID as above, and two booleans.

### Host to browser schemas

| Type | Exact fields and bounds | Rendering rule |
|---|---|---|
| `stateSnapshot` | `{ type, revision, state, capabilities, focusTarget? }`; exact nested schemas below | Source of render truth; must complete before ack |
| `commandPageChunk` | `{ type, revision, chunkIndex, chunkCount, rows }`; indices integers `1..3`, count `1..3`; rows array `1..10`; exact row schema below; at most 25 rows across all chunks for one revision | Webview renders/acks only after the exact declared chunks arrive; duplicates, gaps, metadata mismatch, or wrong row total reject the page |
| `commandDetails` | `{ type, revision, commandId, phrases, slotSummary, executorLabel, enabled }`; known ID; phrases array `1..20`, each `1..120` and `<=1200` total code points; summaries `0..240`; enabled boolean | Display/edit context only; executor/slots read-only |
| `planningProviderState` | `{ type, revision, selectedProvider, items }`; selection is `off` or a provider ID; `0..8` unique exact provider rows using the schema below; a non-off selection must be present in the array | Bounded profile/capability projection only; no secret, receipt, endpoint, or test result |
| `agentPageState` | `{ type, revision, pageIndex, pageSize:8, totalCount, pageRowCount, items }`; page `1..4`, total `0..32`, rows `0..8`; count/page invariants and exact unique agent rows below | Bounded management projection; no instructions or prompt body |
| `customCommandPageState` | `{ type, revision, pageIndex, pageSize:10, totalCount, pageRowCount, items }`; page `1..5`, total `0..50`, rows `0..10`; count/page invariants and exact unique summary rows below | Bounded summaries only; no phrases, arguments, pending state, or authority |
| `customCommandDetails` | `{ type, revision, id, label, description, phrases, kind, targetId, enabled, agentEnabled }`; exact custom ID and draft bounds above | One requested editable projection; no raw JSON or host executor object |
| `setupState` | `{ type, revision, microphoneState, microphoneLabel, systemTtsEnabled, systemTtsVoiceIndex, systemTtsRate, stepStates, recommendedStep }`; exact bounds and invariant below | Authoritative setup reconstruction only; carries no secret, consent choice/result, authority, or action result |
| `diagnosticsState` | `{ type, revision, status, summary, checks, canOpen, canCopy }`; status `idle|running|ready|error`; summary `0..240`; `0..8` exact checks; booleans | Safe results projection only; raw audio, private paths, credentials, authority IDs, and unbounded logs stay host-side |
| `statusUpdate` | `{ type, revision, operationId, channel, phase, message, percent? }`; operation ID pattern `[A-Za-z0-9_-]{1,64}` generated by host; channel `progress|success|error`; phase `idle|starting|running|finalizing|complete|failed|cancelled`; message `0..240` code points; percent integer `0..100` or absent | Content-free; browser cannot invent operation IDs |
| `transcriptUpdate` | `{ type, revision, operationId, sequence, kind, text }`; host operation ID as above; sequence safe integer; kind `partial|final`; text `0..4000` code points and `<=16 KiB` UTF-8 | Partial is display-only; one final per operation/sequence |
| `focusReturn` | `{ type, revision, target }`; exact `FocusTarget` below | Apply after render, before ack; stale revisions ignored |

`state` is a closed record with: `route`; `routeState` (`loading|empty|not-configured|configuring|ready|error|recovery`); optional persisted `filter` and `page`; transient optional `setupStep` and known `commandId`; config-derived `language` (`he|en`) and `direction` (`rtl|ltr`); `effectiveAutoMode` boolean; optional `pendingReview` as `{ kind:'builtin'|'custom', displayLabel }` where the label is `1..120` code points; and optional Commands-only `commandPage` metadata using the exact schema below. `pendingReview` and `commandPage` are host-projected, display-only, and never persisted.

For `route='commands'`, `state.commandPage` is required and is the closed record `{ pageIndex, pageSize, filteredCount, pageRowCount, chunkCount }`:

- `pageIndex` is integer `1..4`, equals the host-validated/clamped persisted `page`, and must not exceed `max(1, ceil(filteredCount / 25))`.
- `pageSize` is the constant integer `25`.
- `filteredCount` is integer `0..100` after all active filters.
- `pageRowCount` is integer `0..25` and exactly `min(25, max(0, filteredCount - ((pageIndex - 1) * 25)))`.
- `chunkCount` is exactly `ceil(pageRowCount / 10)`, therefore `0..3`.

Each `commandPageChunk.rows[*]` is the closed record `{ commandId, enabled, availability, overridden, primaryPhrase, localizedLabel, slotShortcutSummary }`. `commandId` is a known catalog ID of `1..80` printable non-space ASCII characters; `enabled` and `overridden` are booleans; `availability` is `available|unavailable|blocked`; `primaryPhrase` and `localizedLabel` are each `0..120` Unicode code points; `slotShortcutSummary` is `0..240` Unicode code points. These strings are host-projected display text and are rendered with safe text APIs. They contain no raw executor arguments, path, authority data, or secret.

`capabilities` is a closed record `{ sttProvider, sttState, streamingPartials, systemTtsState, localSpeechState, remoteProcessing }`: provider `none|soniox`; STT state `not-configured|configuring|ready|error`; booleans for partial/remote; system TTS state `off|configured-unverified|ready|unavailable|error`; local speech state is the constant `pending-not-available`. `configured-unverified` means configuration is enabled but this browser generation has not yet supplied bounded OS voice evidence; it is not `ready`, does not grant authority, and does not imply that a voice exists.

Management projection rows are closed:

- A planning provider row is `{ id, name, enabled, model, locality, credentialRequired, credentialConfigured, consentRequired, consentAcknowledged }`: allowlisted provider ID; name `1..80`; model uses the shared model pattern; locality `local-loopback|remote`; all remaining fields booleans. The booleans are status evidence, never a secret or consent receipt.
- An agent row is `{ id, name, description, provider, model, enabled, isDefault, instructionsConfigured }`: bounded agent ID; name `1..80`; description `0..400`; allowlisted provider; bounded model; three booleans. The browser sees only whether instructions exist, never their text.
- A custom summary row is `{ id, label, description, kind, targetId, enabled, agentEnabled }` with the shared custom ID, label, description, kind, target, and boolean bounds. Phrases appear only in `customCommandDetails` and use the shared phrase-list bound.
- For either management page, `items.length === pageRowCount`; IDs are unique; page index cannot exceed `max(1, ceil(totalCount/pageSize))`; and row count equals `min(pageSize, max(0, totalCount - ((pageIndex-1)*pageSize)))`.

`setupState` uses microphone state `unselected|untested|testing|signal-detected|no-signal|unavailable|error`, microphone label `0..120` code points, boolean TTS enabled, voice index `-1..19`, and finite TTS rate `0.5..2`. `stepStates` is an exact four-item tuple in setup order; each item is `complete|attention|pending`. `recommendedStep` is integer `1..4` and must equal the first tuple position that is not `complete`, or `4` when all four are complete. This invariant makes fresh, partial, and fully complete reloads deterministic without persisting a selected step.

Each diagnostics check is exactly `{ kind, status, message }`. Kind is `microphone|speech-to-text|system-speech|commands|authority|assistant`; status is `ready|attention|unavailable|error`; message is `0..240` code points. `canOpen` and `canCopy` describe currently available host operations and are not result authority.

`FocusTarget` is a closed discriminated record. It is exactly one of `{ kind:'route-h1' }`, `{ kind:'results-heading' }`, `{ kind:'pending-custom-review' }`, `{ kind:'command-row', commandId }`, or `{ kind:'trigger', trigger:'auto-badge|provider-card|mic-control|pending-review' }`. Only the host emits it. No selector, DOM ID, arbitrary string, operation ID, or pending token is accepted as a focus target.

Unknown message types and unknown fields are rejected. The browser may not send action outcomes or claim that a host operation succeeded.

On the Commands route, `stateSnapshot.state.commandPage` makes completion decidable and every `commandPageChunk` carries the same revision and exact `chunkCount`. The host sends chunks in ascending contiguous order after the snapshot. When `pageRowCount=0`, `chunkCount` must be `0`, the host sends no chunks, and the webview renders the empty state, applies its focus target, and acks that revision immediately. When `pageRowCount>0`, `chunkCount` is `1..3`; the webview sends one `ack` only after indices `1..chunkCount` have arrived, each chunk's declared count matches snapshot metadata, the combined row count equals `pageRowCount`, all IDs are unique, and the page has been rendered and focused. A chunk for a zero-result page, another revision, a duplicate/gapped/out-of-range index, a changed count, more than 10 rows in a chunk, or a combined count other than `pageRowCount` rejects the assembled page without partial render or ack.

## 5. Bounded parser contract, both directions

Every envelope must satisfy all rules before discriminating on `type`:

1. Plain own-property record with prototype exactly `Object.prototype` or `null`; no arrays at the envelope root.
2. JSON serializable and at most 64 KiB in UTF-8. `transcriptUpdate.text` has the stricter 16 KiB bound above.
3. Across the entire envelope: maximum nested depth 4 (root is depth 1), maximum 256 traversed nodes, maximum 128 own properties, maximum 64 total array items, and maximum 100 scalar leaves. A maximum `commandPageChunk` has 10 rows × 7 row scalars + 4 envelope scalars = 74 scalar leaves, 75 own properties, 10 array items, and 86 traversed nodes. Its four bounded row strings total at most 560 code points per row; even JSON escaping remains below the independent 64 KiB envelope cap. A page is assembled from at most three chunks and exactly `pageRowCount<=25` rows.
4. No accessor properties. Reject `__proto__`, `prototype`, and `constructor` at any depth.
5. `type` is an exact allowlisted string. Unknown fields are rejected for that message type.
6. `route` is one of the six IDs. Unknown route is content-free logged and safely converted to `home`, without preserving its params.
7. `params` uses the exact four-key closed schema in section 4. `commandId` and `setupStep` are transient deep-link context and must not enter persistence. No URL, selector, path, command argument, pending-action ID/token, or HTML value is accepted.
8. Reject browser-to-host objects containing authority or result fields anywhere, including `confirmed`, `approved`, `receipt`, `nonce`, `effectiveAutoMode`, `consentGranted`, `outcome`, or equivalents.
9. Every mutating browser intent must carry the current applied `revision`; missing, stale, future, non-integer, or duplicate mutating intents are rejected before side effects.
10. Logs record event type/reason and a host-generated operation/correlation ID only; they omit transcript, secret, query, path, and Git message content.
11. Host-to-browser output has an absolute denylist: no credential/secret/API key/auth header, consent or Auto receipt, nonce, installation/profile identity, internal prompt epoch/fingerprint/target snapshot, absolute/workspace/home/global-storage/model path, raw command arguments, or private Git message. A normalized human display label is allowed only in its explicitly bounded schema field and is never named `path`, `token`, `secret`, `receipt`, or `nonce`.
12. Dynamic text is rendered with `textContent` or equivalent safe DOM APIs only. No `innerHTML`, template HTML from data, `eval`, user-derived URL, inline handler, or inline style.

## 6. Route and setup state matrix

The shared active route state union is `loading | empty | not-configured | configuring | ready | error | recovery`. `unsupported` is a capability qualifier. `downloading` is reserved for the future blocked local track and is rejected as an active Wave 1 transition.

| From | Event | To | Host action | Focus/announcement |
|---|---|---|---|---|
| any | valid deep link | `loading` or current snapshot state | Validate, increment revision, snapshot | Route H1 after render; no duplicate route live message |
| `loading` | successful snapshot/result | `empty`, `not-configured`, `configuring`, `ready`, or `recovery` | Publish one revisioned transition | Polite status if meaningful; never steal focus |
| `loading`/`configuring`/`ready` | bounded failure | `error` | Record content-free failure, no automatic retry | Error heading; one alert on transition |
| `empty` | primary create/configure intent | `configuring` | Start host-owned safe flow | Current step heading/first invalid field |
| `not-configured` | choose Soniox | `configuring` | Require selection, SecretStorage credential, and remote consent before network | Provider setup heading |
| `not-configured` | leave STT off | `not-configured` | Keep provider `none`; zero network | Return to route state heading |
| `configuring` | completed valid setup | `ready` | Revalidate capability and snapshot | Success region once, then primary control |
| `configuring` | cancel | prior safe state | Discard ephemeral entry; do not infer consent | Trigger or setup heading |
| `ready` | capability lost | `error` or `recovery` | Stop new work; never silently fallback | Recovery/error heading |
| `error` | retry/repair | `loading` or `configuring` | Explicit retry only | Keep focus on action until snapshot ack |
| `recovery` | resolved | current safe state | Project host operation/configuration | Semantic recovery target |
| any | forged/stale/oversized message | unchanged | Reject and content-free log | No announcement unless user action needs a safe error |

Setup progress is exactly 1..4 within `home`. Until the same-revision `setupState` arrives, Home shows a bounded loading status and does not assume Step 1. A validated `setupStep` from a new explicit deep link selects the current panel for that revision; otherwise the browser uses `setupState.recommendedStep`. Every step control and panel exposes its independent `complete|attention|pending` marker plus `aria-current="step"` for the selected panel. Current and complete are separate concepts. If all four states are complete, Home announces an all-complete `4 / 4` summary and uses Step 4 only as the defined fallback panel. Browser step navigation changes no completion state.

The host derives the tuple from authoritative state, including the strict versioned setup-choice record above. If the marker is absent/invalid or the host otherwise cannot prove a prior choice after a lifecycle boundary, it safely emits `pending` rather than treating a default `none`/off value as user completion:

| Position | `complete` | `attention` | `pending` |
|---|---|---|---|
| 1 Microphone | Explicit input has host-observed non-zero PCM (`signal-detected`) | `no-signal|unavailable|error` | No completed signal proof, including `unselected|untested|testing` |
| 2 Speech-to-text | Marker/provider are both `none`, or both are `soniox` and STT is `ready` | Marker/provider are both `soniox` and STT is in `error` | Marker is `pending`, marker/configuration disagree, or explicit Soniox setup is still in progress |
| 3 System speech | Marker is `off` with disabled/live `off`, or marker is `system` with enabled/live `ready` | Marker is `system`, output is enabled, and live state is `configured-unverified|unavailable|error` | Marker is `pending`, or marker/configuration disagree; observation alone does not complete an undecided fresh default |
| 4 Commands/authority | Built-in/custom command state and the host authority cache are initialized and healthy | A pending action needs review, mapping state is corrupt/untrusted, or another host-owned review issue needs attention | Commands/authority state is not initialized yet |

On reload/restart, the host emits a fresh tuple and recommendation; neither is browser persistence. A secret field, consent choice/result, native prompt, overlay, pending review, pending action, setup tuple, and recommendation are never restored by `webview.setState` or Control Center `workspaceState`.

### Management, custom-command, system-TTS, and diagnostics transitions

| State/event | Host transition | Browser presentation | Boundary |
|---|---|---|---|
| Provider/agent/custom page request | Validate revision, target, exact page range; publish a new revision and exact page projection | Preserve independent UI focus after the final projection | Page requests grant no provider, agent, command, or action authority |
| Planning provider `select|save-profile` | Validate allowlisted provider/model and configuration; publish bounded profile state | Render selection/capability booleans | Enabled/configured flags are evidence only; credentials and consent remain native/host-owned |
| Planning credential/consent/test operation | Open or continue the host-owned native flow; then publish bounded state/status | No secret field and no browser-authored outcome | Native explicit consent and host revalidation remain mandatory |
| Agent create/update/toggle/default/duplicate/delete | Validate closed intent against host catalog and publish the exact bounded page | Render only row/profile status | Browser never receives or edits agent instruction text or prompt authority |
| Custom `open` | Accept only the latest safe-integer request sequence for the current revision and ID; publish `customCommandDetails` | Open/reopen the same friendly form deterministically | Sequence is replay/correlation control, not authorization |
| Custom add/edit | Validate the full draft and host allowlists before mutation; publish page/details | Preserve visible bounded fields and show validation errors | No raw JSON, arguments, executor object, result, or dispatch |
| Built-in/custom set-enabled | Change only enabled state, then publish a revision | Existing phrases remain intact, including re-enable | Enablement is management state, not pending-action approval; built-in `reset` is a separate explicit operation |
| TTS configuration intent | Validate enabled/voice index/rate; map voice index only against the current same-revision observed list and persist the host-owned voice identity | Update controls from the next setup/capability projection | Voice observation and selection never grant action authority |
| Diagnostics `run` | `idle|ready|error -> running -> ready|error`; publish bounded `diagnosticsState` | One status summary plus `0..8` checks | Browser supplies no checks/results and diagnostics upload no audio implicitly |
| Diagnostics `open|copy` | Act only when current host state permits `canOpen|canCopy`; otherwise no-op/safe status | Buttons reflect the host booleans | No private path, raw report, secret, or authority identifier crosses the protocol |

System TTS capability transitions are exact:

| Capability | Meaning | Setup marker and UI rule |
|---|---|---|
| `off` | Host configuration disables system speech | Complete only with marker `off`; otherwise Pending. Preview/voice controls disabled |
| `configured-unverified` | Enabled configuration exists, but this browser generation has not yet supplied bounded OS voices | Never ready. Setup is Pending when the TTS choice marker is `pending`, or Needs attention after an explicit `system` choice; show only the temporary/OS-dependent observation label and wait for evidence |
| `ready` | Current browser evidence contains a usable bounded voice selection/default | Complete only after marker `system`; otherwise setup remains Pending. Preview remains presentation-only |
| `unavailable` | Observation returned no usable voice or the configured voice is absent | Needs attention after explicit `system`, otherwise Pending; explain OS capability and do not select a fallback provider |
| `error` | Host-projected configuration/capability error | Needs attention after explicit `system`, otherwise Pending; explicit recovery only |

The Step 4 status is system-readiness evidence, not a statement that the user approved Auto or a pending action. Its review buttons navigate to Commands and Privacy; navigation itself changes no authority and creates no review receipt. A healthy `complete` marker therefore means only that the bounded command state and authority cache are ready to inspect.

## 7. Provider capability state machine

| Provider configuration | Network allowed | Partial display | Final dispatch candidate | UI label |
|---|---:|---:|---:|---|
| `none` | No | No | No | Not configured |
| Soniox selected, no secret | No | No | No | Configuration incomplete |
| Soniox selected + secret, no remote consent | No | No | No | Remote consent required |
| Soniox fully opted in, connecting | Yes, host only | No | No | Connecting to Soniox — remote processing |
| Soniox streaming | Yes, host only | Yes | No for partial | Listening — remote processing |
| Soniox final | Existing session finalization only | Final replaces partial | Yes, after wake/safety/validation/authority gates | Final transcript |
| Soniox failed/credential removed | No new/retry connection without revalidation | Clear or mark stale | No | Repair Soniox configuration |
| System TTS off | Not applicable | Not applicable | Not applicable | Off |
| System TTS configured, not observed in this browser generation | Not applicable | Not applicable | Not applicable | System voice — temporary and OS-dependent; needs observation, not ready |
| System TTS ready | Not applicable | Not applicable | Not applicable | System voice — temporary and OS-dependent |
| System TTS unavailable/error | Not applicable | Not applicable | Not applicable | Explain the OS capability/error; no silent fallback |
| Deferred offline/local speech | No implementation in Wave 1 | No | No | Planned and pending, but not included or available in this version. System voices remain separately OS-dependent |

There is no silent provider fallback. Partial text never reaches the matcher. Reconnect is never allowed after a command may have dispatched.

### Soniox consent handoff and connection gate

The browser can only send `{ type:'providerSetupIntent', revision:r, provider:'soniox', request:'request-remote-consent' }`. The host creates a host-only pending consent prompt and shows a native VS Code modal that names Soniox, remote audio processing, and the endpoint policy. The prompt may only be created from a focused window, and the pending record has a random one-shot nonce and consent-prompt epoch bound to provider, active profile, credential generation, credential fingerprint, installation-secret epoch, endpoint-policy/consent versions, panel generation, and expiry. Window focus is not re-checked at confirmation, because the native modal itself takes focus away from the window that requested it. The DOM does not receive or return a consent checkbox/result or any binding value.

Only an explicit native confirm can consume that pending record once, after immediate revalidation, and create a machine-local consent receipt. The receipt is bound to `provider='soniox'`, a hash of the active local VS Code profile identity, the credential generation, `endpointPolicyVersion`, `consentVersion`, and a monotonically increasing consent epoch. It is not synced, exported, or sent to a webview. The Soniox secret remains only in `SecretStorage`.

Immediately before opening every WebSocket, the host atomically captures and rechecks one generation containing: selected provider, current SecretStorage credential version/presence, valid consent receipt, profile hash, endpoint-policy version, consent version, and consent epoch. The socket may open only if all values still match the confirmed generation. No check result is cached across a connection/reconnect boundary.

Consent revoke, credential create/change/delete, an installation-secret value this host did not write, profile change, provider change, endpoint-policy/consent-version change, consent-epoch change, panel-generation change, workspace-context change, cancel, dismiss, or timeout invalidates the pending prompt. Once configured, consent revoke, credential create/change/delete, profile/provider/policy/version/epoch change aborts connecting/streaming/finalizing work, closes the socket, clears buffers, invalidates both the consent receipt and connection generation, and prevents reconnect until a fresh explicit native confirmation and atomic recheck. These events never select another provider automatically.

## 8. Auto and native prompt handoff

Effective Auto is computed only by the host from a valid machine-local receipt. The browser may show requested state but cannot grant it.

```text
AUTO_OFF
  -> requestAutoEnableIntent
EXPLANATION_MODAL
  -> continue: close DOM modal, remove inert, notify host
NATIVE_PROMPT_PENDING
  -> explicit native confirm: host validates and creates receipt -> AUTO_ON
  -> cancel/dismiss/error: unchanged -> AUTO_OFF
AUTO_ON
  -> disableAutoIntent: immediate receipt invalidation -> AUTO_OFF
```

No DOM overlay remains under `showWarningMessage(..., { modal:true })`. After the native result, the host reveals the canonical panel if needed, sends a revisioned snapshot with a semantic focus target, and the webview restores focus before ack. Forged/replayed `confirmed`, raw JSON, Settings Sync, imports, and browser state grant zero authority.

Before showing an Auto or action prompt, the host creates an in-memory pending-prompt record containing a cryptographically random host-only nonce, prompt epoch, prompt kind, current authority/consent epoch, active profile and installation binding, current trust and panel generation, exact policy/consent versions, and expiry. Every prompt may only be created from a focused window, but window focus is not part of the binding that is re-compared after the modal. For an action prompt it also binds the exact action fingerprint, typed arguments digest, executor ID, risk tier, and target snapshot (workspace/repository/document/branch/selection as applicable). None of these internal fields are sent to the browser.

The native callback closes over the host record. An explicit confirm is accepted once only when nonce and epoch still identify the sole pending prompt, it is unconsumed/unexpired, and immediate revalidation reproduces the same action fingerprint, target snapshot, policy, trust, profile, panel generation, credential/consent state, and authority epoch. Window focus is not re-compared there, because the native modal blurs the window that requested it; the feature layer still requires a focused window before it mutates a target. The host marks it consumed before creating an Auto receipt or dispatching. A second callback, replay, or unknown outcome performs no action and is never retried.

Any Auto toggle, consent revoke/change, credential create/change/delete, profile change, workspace trust change, editor focus/selection change relevant to the target, panel reload/adoption/disposal generation change, explicit cancel, timeout, or action/pending-state change invalidates the pending prompt before a result can be consumed. For Auto enable, target snapshot means the exact requested `enabled=true` transition plus installation/profile/policy/consent/authority generation; for ordinary actions it is the full command target snapshot above.

## 9. Commands pagination state

- Page size is fixed at 25; `page` is 1..4 for the exact-100 built-in catalog.
- The persisted `filter` is one bounded internal composite token, never search-box copy. Canonical grammar is `v1:<categoryIndex>:<enabledBit>:<changedBit>:<query>`: category index `0..7` maps to none, Editing, Selection/Cursor, Files/Tabs, Search/Navigation, Code/Refactor, Panels/Debug/Tests, or Git; each bit is `0|1`; query is at most 180 code points; and the complete token is at most 200. Empty state serializes to `''`. Legacy `enabled:true`, `changed:true`, and `category:<known-category>` tokens remain readable; any other legacy string is treated only as a bounded query.
- Search, category, Enabled only, and Changed from default updates compose with the other three values. Rendering parses the token back into a query-only search value, one category pressed state, and independent checkbox `checked` values; the token/prefix never appears in a visible field.
- Snapshot `filteredCount` controls `aria-rowcount` and total pages; `pageRowCount` and `chunkCount` determine exact completion. Empty results require `pageIndex=1`, `pageRowCount=0`, `chunkCount=0`, no chunks, an empty render, and then ack.
- Filter changes reset to page 1. Page changes focus the first result after the exact command chunks render. Any later same-revision custom/management projection captures and restores the semantic focus bookmark around its rerender, so it cannot erase that result focus.
- In-session row updates return focus by a transient stable `commandId`; it is not restoration persistence. If the row is filtered out or unavailable, use the results heading.
- Each accepted change gets a new host revision; a stale filter/page response is ignored.
- No virtualization, unbounded list payload, or browser-owned catalog truth.

### Pending custom-mapping review

The compact sidebar sends a payload-free `openPendingReviewIntent` tied only to the currently applied revision. It never supplies a mapping ID, pending-action ID, approval token, receipt, nonce, requested outcome, or executor arguments. The host resolves its own current pending action and opens the canonical `commands` route. For a pending custom mapping it projects a bounded safe summary and the fixed semantic focus target `pending-custom-review`; for a built-in it may project a validated catalog `commandId`. Both are transient and never persisted.

The Control Center review buttons send only review intents for the host's current pending action. The host re-resolves and revalidates pending state immediately before any native confirmation or dispatch. If no matching host-owned pending action remains, no review or dispatch occurs and focus falls back to the Commands H1. A browser-supplied token, pending ID, `approved`, or outcome is rejected as an authority-bearing field.

## 10. Disposal and non-replay matrix

| Host-owned item | On panel dispose/reload | On new panel snapshot |
|---|---|---|
| Soniox session | Remains governed by speech controller; no duplicate connect | Display current bounded status only |
| Pending action | Remains host-owned; no automatic approval/dispatch | Display a bounded summary and host-projected built-in row or `pending-custom-review` target only; never persist either |
| Auto receipt | Remains machine-local; browser never caches it | Display effective boolean/capabilities only |
| Display route/filter/page | Persist only these bounded values | Restore after validation; derive language/direction from config and omit transient command/setup/review targets |
| Modal/drawer | Discard | Closed |
| Focus-return handle | Clear stale handle; host may issue a new semantic target | Apply once after render |
| Queued browser intent | Discard | User must repeat unless host operation already owns it |

## 11. Acceptance checklist

- [ ] Singleton, serializer/command dedup, latest-explicit-deep-link-wins, and disposal are deterministic.
- [ ] `ready -> snapshot -> render/focus -> ack` rejects stale revisions.
- [ ] Persisted state is exactly bounded route/filter/page; command, setup, pending-review, language, and direction context are transient or config-derived and never persisted.
- [ ] Parser enforces size, depth, cardinality, prototype, accessor, key, type, route, param, and authority-field rules in both directions.
- [ ] Every message has a closed field schema; every mutating browser intent carries the current revision; operation IDs, transcripts, focus targets, page chunks, strings, nodes, properties, items, and scalars are explicitly bounded.
- [ ] The browser table enumerates all 22 current message families and the host table all 12; protocol tests fail when either inventory drifts.
- [ ] Setup waits for authoritative state, validates the exact four-state tuple/recommendation invariant, distinguishes current from complete/attention/pending, and reconstructs fresh/partial/all-complete reloads without browser persistence.
- [ ] Provider, agent, custom-command, system-TTS, and diagnostics schemas and transitions remain bounded; `configured-unverified` is never readiness or authority, and maps to Pending before a choice or Needs attention after explicit `system`.
- [ ] Commands snapshots expose bounded `pageIndex/pageSize/filteredCount/pageRowCount/chunkCount`; zero results require zero chunks, while non-empty pages ack only after exact contiguous chunk completion.
- [ ] Every projected command row includes bounded localized label, primary phrase, availability, override/enabled state, and slot/shortcut summary while remaining within 64 KiB and 100 scalar leaves per envelope.
- [ ] All route states define safe transitions, action, focus, announcement, and recovery.
- [ ] Provider capabilities control partial UI; partial never dispatches.
- [ ] Auto authority crosses only a native prompt and returns focus through a revisioned handshake.
- [ ] Soniox network requires a native consent receipt bound to provider/profile/endpoint policy/version/epoch and an atomic SecretStorage+receipt recheck; revoke/change aborts the socket and invalidates the generation.
- [ ] Auto/action prompts are host-nonce/epoch/fingerprint/target/policy bound, one-shot, immediately revalidated, and invalidated on every specified context change.
- [ ] Pending custom review uses a payload-free browser intent and a fixed host-projected, non-persisted focus target; browser IDs/tokens/outcomes grant nothing.
- [ ] No local runtime/download/ready transition exists in Wave 1.
