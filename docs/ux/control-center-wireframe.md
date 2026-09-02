# Voice Input Control Center — wireframe contract

**Status:** frozen for Wave 1 implementation

**Surface:** one editor-area `WebviewPanel` per VS Code window / Extension Host

**Non-claim:** Wave 1 does not provide local/offline/keyless speech, model downloads, or a local-ready state.

This contract is authoritative for the Wave 1 Control Center. Where an older UX document describes local model packs or a download flow, this document takes precedence: those controls are not rendered in Wave 1.

## 1. Canonical surface and entry points

The Control Center occupies the full available editor-group area. It does not cover VS Code chrome or create an operating-system window. Every entry point calls the same host-owned `createOrShow(route?, params?)` API:

- Activity Bar and legacy Settings launcher;
- Command Palette;
- status bar and readiness/recovery cards;
- compact sidebar links;
- notification actions and restored panels.

Repeated opens reveal the existing panel. Separate VS Code windows may each own one panel; a single Extension Host may not own two. A requested deep link is applied to the canonical panel, never to a second settings surface.

## 2. Information architecture

There are exactly six route IDs. Setup is a state within `home`, not a seventh route.

| Route ID | Visible title | User question | Primary action | Focus after navigation |
|---|---|---|---|---|
| `home` | Home / בית | What is ready and what should I do next? | Continue setup or start recording | `h1#route-title-home` |
| `voice` | Voice & Microphone / קול ומיקרופון | Can the microphone, STT, and system voice work now? | Start/stop microphone test | `h1#route-title-voice` |
| `commands` | Commands / פקודות | What can I say and how can I change it? | Search the command catalog | `h1#route-title-commands` |
| `assistant` | Assistant & Providers / עוזר וספקים | Which provider is selected and what are its capabilities? | Configure or test the selected provider | `h1#route-title-assistant` |
| `privacy` | Privacy & Safety / פרטיות ובטיחות | What leaves the machine and what can execute automatically? | Disable Auto immediately, or start the native enable flow | `h1#route-title-privacy` |
| `diagnostics` | Diagnostics / אבחון | Why is a capability unavailable? | Run content-free diagnostics | `h1#route-title-diagnostics` |

Legacy routes map deterministically: `setup|general -> home`, `conversation|speech|microphone -> voice`, `actions|mappings -> commands`, and `agents|providers|assistant -> assistant`; the six canonical route IDs remain unchanged. A separately validated `setupStep` parameter may accompany `home` but is never inferred from the legacy route name. An unknown route is rejected, logged without user content, and falls back to `home` without retaining params.

## 3. Wide layout

The breakpoint is content-driven: wide mode is used only while navigation, a readable main column, and controls fit without clipping or horizontal scrolling.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Skip to content    Voice Input                 Provider status   AUTO   │
├───────────────────┬──────────────────────────────────────────────────────┤
│ Primary navigation│ MAIN                                                 │
│ Home              │ H1 Route title                                      │
│ Voice & Microphone│ One-sentence purpose                                 │
│ Commands          │                                                      │
│ Assistant         │ ┌ Readiness / recovery ───────────────────────────┐ │
│ Privacy & Safety  │ │ status, reason, one safe primary next action    │ │
│ Diagnostics       │ └──────────────────────────────────────────────────┘ │
│                   │                                                      │
│                   │ Route content                                        │
│                   │                                                      │
│                   │ [Primary action] [Secondary action]                  │
├───────────────────┴──────────────────────────────────────────────────────┤
│ Status regions: progress | success | error                              │
└──────────────────────────────────────────────────────────────────────────┘
```

- Header, named navigation, `main`, and status regions are separate landmarks.
- Navigation remains visible and does not cover or push active content outside the viewport.
- Main content may use the available width for tables, while prose retains a readable line length.
- No sticky action area may hide focused content.

## 4. Narrow layout, 320 CSS px, and 200% zoom

At the first width where the wide composition would clip, wrap controls ambiguously, or require horizontal scrolling, the navigation becomes a single drawer.

```text
┌──────────────────────────────┐
│ [Menu] Voice Input   [AUTO]  │
├──────────────────────────────┤
│ MAIN                         │
│ H1 Commands                  │
│ Route purpose                │
│ [Search commands..........]  │
│ [Category] [Filters]         │
│                              │
│ Command row                  │
│ Phrase and availability      │
│ [Enabled] [Edit]             │
│                              │
│ [Previous] 1 of 4 [Next]     │
├──────────────────────────────┤
│ Status                       │
└──────────────────────────────┘
```

- One content column; no horizontal overflow at 320 CSS px or 200% zoom.
- Table rows may render as stacked rows, but retain coherent table/list semantics and DOM order.
- Long branch, file, command, and provider values wrap; truncation always has an accessible full-value path.
- The Menu button has visible text, `aria-expanded`, and `aria-controls` pointing to the real navigation drawer.
- Interactive targets are at least 44 by 44 CSS px.

## 5. Home setup: exactly four steps

Home contains a “Complete setup” card. It waits for same-revision `setupState` rather than assuming Step 1, then marks all four steps independently as Complete, Needs attention, or Pending and marks exactly one current panel. A new validated transient `setupStep` selects the current panel; otherwise the host-projected `recommendedStep` selects the first non-complete step, or Step 4 when all four are complete. The all-complete reload shows an explicit `4 / 4` summary. Step status, recommendation, and selected `setupStep` are never persisted in Control Center `workspaceState` or browser state.

1. **Microphone:** choose an explicit input device and prove a non-zero signal. Device enumeration alone is not success.
2. **Speech-to-text:** keep `Not configured`, or explicitly select Soniox. Soniox configuration explains remote processing and collects the secret through a VS Code-owned credential flow. The browser can only request a host-owned native remote-processing prompt; explicit native confirmation creates the machine-local provider/profile/endpoint-policy/version/epoch-bound consent receipt. SecretStorage and that receipt are atomically rechecked immediately before every WebSocket. The step may be skipped.
3. **Speech output:** select system TTS or leave it off. Available voices come from the operating system. Preview and configured output use the same provider and are labelled **“System voice — temporary and OS-dependent.”** An enabled configuration is `configured-unverified`, never ready: it remains Pending while the TTS choice marker is undecided, and becomes Needs attention after explicit `system` selection until the current browser reports bounded OS voice evidence. Observation is capability evidence only and cannot complete a still-undecided fresh default; `system` plus a ready observation completes the step. No available OS voice is an unavailable-capability state, not a reason to select another provider silently.
4. **Commands and authority:** review the 100 built-in commands, confirmation policy, and Auto Mode. Its setup marker reflects whether command state and the host authority cache are initialized/healthy, or need attention; it is not a review receipt or approval. Auto remains effectively off until a separate native VS Code warning is explicitly confirmed.

There is no local voice pack step, download button, model selector, installed-model status, or local-ready copy in Wave 1.

## 6. Route content and states

Every route implements the relevant members of this active state vocabulary:

| State | Required content | Primary/safe action | Initial/fallback focus | Deep-link and restore behavior |
|---|---|---|---|---|
| `loading` | Stable skeleton plus visible “Loading” label; content region `aria-busy=true` | None that can duplicate work | Route H1 remains focused | Restore only bounded route/filter/page; request a fresh snapshot |
| `empty` | What is empty and why it matters | One creation or configuration action | Empty-state heading | Deep link stays on route; no overlay restored |
| `not-configured` | Capability name, missing requirement, and privacy impact | Configure, choose provider, or leave off | State heading | A transient host-validated `commandId`/setup step may focus the relevant card after ack; neither is persisted |
| `configuring` | Current step, completed requirements, and cancellable boundary | Continue or Cancel | Current step heading or first invalid field | Reload restores only route/filter/page; same-revision setup status/recommendation is rebuilt from authoritative host state |
| `ready` | Capabilities, last safe result, and the selected configuration | One route-specific primary action | Route-specific target, otherwise H1 | Fresh host snapshot determines truth |
| `error` | What failed, what did not change, and a content-free code | Retry, Repair, or Choose another configured option | Error heading; `role=alert` only on transition | Reload does not retry or repeat a dispatch |
| `recovery` | Detected safe state and one concrete recovery step | Resume UI, reselect provider, or reopen review | Recovery heading | Host operation ID/state is projected; browser state cannot resume work |

`unsupported` may qualify any active state and must name the unavailable capability without a misleading action. `downloading` is a reserved future local-speech state and is not reachable, rendered, deep-linked, or announced in Wave 1.

### Route-specific application

| Route | Required state examples | Required recovery/action rule |
|---|---|---|
| `home` | setup incomplete, ready summary, authority changed | One next step; never label local speech ready |
| `voice` | mic loading/error/ready; STT not configured; system voice unavailable/ready | Partial transcript appears only with `streamingPartials`; only final may enable command handling |
| `commands` | loading, 0 filtered results, ready page, invalid override recovery | Empty filter result clears filters; editing uses one drawer |
| `assistant` | provider none, Soniox configuring/ready/error, system TTS unavailable/ready | Soniox repair never opens a connection before secret and consent are valid |
| `privacy` | Auto off/on, consent absent/present, native prompt pending | Auto off is immediate; enable crosses a native prompt only |
| `diagnostics` | idle/loading/ready/error | Diagnostics are content-free and never upload audio implicitly |

## 7. Commands route

The command catalog is a dense, accessible table/list rather than 100 cards.

- One labelled search field covers ID, label, and HE/EN phrases.
- Filters: seven categories, Enabled only, and Changed from default.
- Exactly 25 rows per page; no virtualization. With 100 unfiltered commands there are four pages.
- `aria-rowcount` equals the filtered result count, not the current page size or a hard-coded 100.
- One row includes enabled toggle, name, primary phrase, slot/shortcut summary, availability, and Edit.
- Edit opens a drawer for phrases, enabled state, reset, and slot preview. Built-in executor ID and slot schema are read-only.
- Custom commands are separate and use a friendly bounded schema form with visible label, description, phrase lines, allowed kind/target, enabled state, and Agent Mode availability. The Control Center provides no raw-JSON wizard.
- Filter or page changes focus the first result, or the empty-state heading. Within the current revision flow, a saved row returns focus by transient stable `commandId`; it is never persisted. If filtering removes it, focus moves to the results heading.
- A dedicated polite live region announces exactly once: “N results, page X of Y.” It does not read every row.
- A sidebar review request contains no pending ID or authority token. The host resolves the current pending action: a built-in can focus a transient validated row, while a custom mapping focuses the fixed transient target `pending-custom-review`. If host pending state no longer exists, focus falls back to the Commands H1 and nothing dispatches.

## 8. Provider and authority presentation

Provider status and available controls are derived from host-owned capabilities:

| Provider/state | Capabilities shown | UI rule |
|---|---|---|
| `none` | No STT | “Not configured”; no network and no automatic fallback |
| Soniox without complete opt-in | Remote streaming unavailable | Explain missing selection, secret, or consent; do not connect |
| Soniox configured | `streamingPartials=true`, final transcript | Show a visually and textually marked partial area; dispatch only final |
| System TTS configured, not observed | `systemTtsState=configured-unverified` | Show the temporary/OS-dependent label; setup is Pending before an explicit choice or Needs attention after explicit `system`; do not claim readiness or authority |
| System TTS ready | OS voice list and preview | Label “System voice — temporary and OS-dependent” |
| System TTS unavailable | No OS voices | Explain OS capability; do not call Soniox or imply built-in/local speech |
| Deferred offline/local speech | Planned and pending, but not included or available in Wave 1 | Explicit nonclaim with no action; then a separate sentence that system voices are OS-provided and may be unavailable |

When effective Auto Mode is active, a persistent `AUTO` badge and immediate kill switch are visible on Home, Voice, Commands, the compact sidebar, and the status bar. The badge is status plus a labelled button; color alone is never the signal. Enabling Auto opens the explanation-to-native-confirmation flow. Disabling it is immediate, requires no modal, and cancels any not-yet-dispatched extension-owned action.

Credential, consent, provider, profile, or endpoint-policy changes immediately invalidate the Soniox connection generation, abort any active socket, and require a fresh native consent when applicable. Auto/action native prompts are bound to a host-only one-shot nonce and epoch plus the exact policy and target/action fingerprint. Toggle, consent/credential/profile/trust/focus/panel-generation changes or cancel invalidate the prompt; a confirmed result is consumed only after immediate host revalidation.

## 9. Direction, copy, and non-claims

- HE uses `lang="he" dir="rtl"`; EN uses `lang="en" dir="ltr"`.
- DOM order stays the same in both directions. Layout uses logical CSS properties; only directional icons mirror.
- Paths, branch names, command IDs, and mixed-language values use `bdi`/`dir="auto"`; code values remain LTR.
- Never use “local”, “offline”, “built-in voice”, “keyless”, “download required”, or “local ready” as a positive Wave 1 speech-capability claim. “Offline/local” appears only in the explicit nonclaim below.
- `local-pending` has no call to action and uses the complete bilingual nonclaim:
  - EN: **“Offline/local speech is planned and pending, but it is not included or available in this version. System voices are OS-provided and may be unavailable.”**
  - HE: **“דיבור לא־מקוון/מקומי מתוכנן ובהמתנה, אך אינו כלול ואינו זמין בגרסה זו. קולות המערכת מסופקים על־ידי מערכת ההפעלה וייתכן שלא יהיו זמינים.”**
- Soniox copy always includes “Remote processing” before opt-in. System TTS copy always includes “temporary” and “OS-dependent”.

## 10. Acceptance checklist

- [ ] Exactly six routes and four setup steps.
- [ ] Fresh, partial, and all-complete reloads use the host setup tuple/recommendation, expose textual status plus current markers, and never briefly assume Step 1.
- [ ] Wide persistent navigation and narrow single-drawer navigation.
- [ ] 320 CSS px, 200% zoom, RTL/LTR, 44 px targets, and no horizontal overflow.
- [ ] All active states define content, action, focus, deep-link, restore, and disposal behavior.
- [ ] Commands show 25 filtered rows per page and filtered `aria-rowcount`.
- [ ] Only route/filter/page persist; command/setup/review focus context is transient and language/direction comes from authoritative configuration.
- [ ] Provider capability controls are conditional and host-owned.
- [ ] Soniox consent is native, machine-local, profile/policy/epoch-bound, and atomically rechecked with SecretStorage before network; revoke/change aborts.
- [ ] AUTO badge and kill switch appear on every required surface.
- [ ] Auto/action prompt results are host-bound, one-shot, context-invalidated, and revalidated before receipt/dispatch.
- [ ] System TTS is explicitly temporary and OS-dependent.
- [ ] No local/download CTA or local/offline/keyless readiness claim exists.
