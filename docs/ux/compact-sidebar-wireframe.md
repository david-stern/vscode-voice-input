# Compact sidebar — wireframe contract

**Status:** frozen for Wave 1 implementation

**Role:** a daily launcher and status surface, never a second settings application

## 1. Content boundary

The sidebar contains only the following blocks, in this DOM order in Hebrew and English:

```text
┌──────────────────────────────┐
│ Voice Input            AUTO  │  visible only while effective Auto is on
│ Soniox configured            │  provider/system status in text
├──────────────────────────────┤
│ Microphone                   │
│ [ Start listening ]          │  visible label, aria-pressed, shortcut
│ Status: Ready                │  live mic status
├──────────────────────────────┤
│ Latest transcript            │
│ Partial: ...                 │  only for streamingPartials=true
│ Final: ...                   │  latest final only
├──────────────────────────────┤
│ Pending: Commit staged       │  short name and state only
│ [Review in Control Center]   │
├──────────────────────────────┤
│ [ Open Control Center ]      │  primary action
│ Voice            Commands   │  two secondary deep links
└──────────────────────────────┘
```

It must not contain provider, endpoint, persona, model, voice, mapping, command-edit, consent, or Auto-enable forms; history beyond the latest transcript; a navigation tree; or an independent Settings DOM. The legacy Settings view is a launcher that opens the same Control Center singleton.

## 2. Status vocabulary

The single top status line may use only these Wave 1 states:

- `Not configured` — STT provider is `none`.
- `Soniox configured — remote processing` — selection, secret, and consent are valid.
- `System voice — temporary and OS-dependent` — system TTS is selected. With `configured-unverified`, this is observation-pending capability copy and must not be announced as ready; with `ready`, a bounded OS voice was observed.
- `System voice unavailable — no OS voice found` — no silent provider change.
- `local-pending` is informational only, has no CTA, and renders the complete two-sentence nonclaim:
  - EN: `Offline/local speech is planned and pending, but it is not included or available in this version. System voices are OS-provided and may be unavailable.`
  - HE: `דיבור לא־מקוון/מקומי מתוכנן ובהמתנה, אך אינו כלול ואינו זמין בגרסה זו. קולות המערכת מסופקים על־ידי מערכת ההפעלה וייתכן שלא יהיו זמינים.`

`Local ready`, `Download required`, `Install voice`, `Works offline`, `Built-in voice`, and `No key required` are prohibited copy and states.

## 3. Quick microphone control

- Native button with visible Start/Stop text; icon-only control is not sufficient.
- `aria-pressed="true"` only while capture is actively requested.
- The shortcut is visible text and is not the accessible name by itself.
- Mic transitions use a dedicated polite status region. Errors use one assertive announcement on transition, followed by ordinary text.
- Start remains disabled with an adjacent reason when provider is `none`, native consent/SecretStorage recheck is incomplete, workspace trust blocks dispatch, or the input device has no valid signal.
- Device enumeration is not readiness; a test must observe non-zero PCM before reporting the microphone ready.

## 4. Transcript and pending action

- The sidebar keeps only the latest partial and latest final transcript, bounded by the host snapshot.
- Partial is visually and textually labelled “Partial / זמני”, uses `aria-live="polite"`, and exists only when provider capability `streamingPartials=true`.
- Partial content is never an enabled execution trigger and is never sent to the matcher.
- Final is labelled “Final / סופי”. Only a final utterance may continue through wake/safety/validation/authority gates.
- Pending action shows a bounded human label and status, never raw arguments, secret, receipt, nonce, private path, or full Git message.
- Review sends a payload-free `openPendingReviewIntent`. The host resolves its own current pending action and opens the canonical `commands` route. A built-in may receive a transient validated catalog `commandId`; a custom mapping receives the fixed host-projected focus target `pending-custom-review`. The sidebar never supplies a mapping/pending ID, authority token, receipt, approval, outcome, or executor argument, and cannot approve or dispatch the action.

## 5. AUTO badge and kill switch

- Effective Auto on is indicated by visible text `AUTO`, an icon if desired, and an accessible name that states it is active.
- The badge is also the immediate kill switch. Activating it requests host-side disable without a DOM modal or second confirmation.
- The sidebar may request enable by opening the Privacy route; it cannot set or infer effective Auto.
- Raw config, a webview message, restored state, or visual toggle position is not authority.
- An Auto/action native prompt result is valid only through the host's one-shot pending nonce/epoch bound to the exact policy, action fingerprint, target, trust/focus/profile, and panel generation. The sidebar receives none of those internal values.
- After disable, the host sends a new revision, cancels not-yet-dispatched extension-owned actions, and returns focus to the badge or the section heading if the badge disappears.

## 6. Deep links and lifecycle

| Control | Canonical target | Focus target after panel ack |
|---|---|---|
| Open Control Center | `home` | Home H1 |
| Voice | `voice` | Voice H1 |
| Commands | `commands` | Commands H1 |
| Review pending built-in | Host-resolved `commands` review | Transient matching built-in row, then Commands H1 fallback |
| Review pending custom mapping | Host-resolved `commands` review | Fixed `pending-custom-review`, then Commands H1 fallback |
| Provider recovery | `assistant` | Recovery heading, then Assistant H1 fallback |

All links reveal the existing singleton. If the Control Center is not ready, only the latest explicit deep link is queued. The pending-review request is resolved from host-owned pending state at handling time and its target is never persisted. If no pending action remains, the host opens Commands at its H1 and dispatches nothing. Hiding or disposing the sidebar does not cancel, repeat, or take ownership of a Soniox session, pending action, or Auto receipt.

## 7. Responsive and accessibility behavior

- The content is one column at every sidebar width and at 200% zoom.
- No horizontal scrolling. Long values wrap using logical sizing; code-like values use `bdi` or `dir="auto"`.
- Interactive targets are at least 44 by 44 CSS px.
- Skip redundant headings; maintain one visible H1 for the view and H2 headings for blocks.
- Tab order follows the DOM diagram; no positive `tabindex`, CSS reordering, or custom arrow-key model.
- Every `aria-controls` value points to a real status, transcript, or panel element.
- Use VS Code tokens, a 3:1 focus indicator against adjacent colors, high-contrast system colors where forced, and no status distinction by color alone.
- Under `prefers-reduced-motion: reduce`, remove nonessential transitions and never animate transcript/status movement.
- `dir` changes visual placement through logical CSS properties and never reverses keyboard order.

## 8. State behavior

| State | Sidebar presentation | Action | Focus/live behavior |
|---|---|---|---|
| `loading` | Stable status placeholder | No duplicate start | Keep current focus; polite “Loading microphone status” once |
| `empty` | “No transcript yet” | Start listening if otherwise available | Empty heading remains reachable |
| `not-configured` | Provider `none` and reason | Open Assistant & Providers | Focus returns to launcher after panel closes |
| `configuring` | “Finish setup in Control Center” | Reveal current setup step | No inline form |
| `ready` | Provider, mic, latest transcript | Start/Stop | Mic status is polite |
| `error` | Short failure and what stayed safe | Open recovery | One alert on transition; no automatic retry |
| `recovery` | Safe next step | Open canonical recovery route | Target heading after panel ack |

`downloading` is reserved for a future local track and must not render in Wave 1.

## 9. Acceptance checklist

- [ ] Only status, quick mic, latest transcript, pending summary, primary launcher, and two deep links appear.
- [ ] Partial UI is conditional on `streamingPartials` and cannot dispatch.
- [ ] AUTO status is visible and its kill switch disables immediately.
- [ ] Every launcher reveals the same Control Center instance.
- [ ] Built-in and custom pending reviews resolve from host state without any browser-supplied ID or authority token; the custom focus target is transient and never persisted.
- [ ] Provider/consent/credential/profile changes abort and invalidate Soniox readiness; sidebar status never outruns the host's atomic SecretStorage+receipt gate.
- [ ] No forms, duplicate navigation, local/download CTA, or untruthful speech claim exists.
