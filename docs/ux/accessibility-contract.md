# Accessibility contract

**Status:** frozen for Wave 1 implementation

**Target:** keyboard-complete, screen-reader understandable, high-contrast-safe, reduced-motion-safe, and usable at 320 CSS px and 200% zoom in Hebrew and English.

## 1. Semantics and landmarks

Every Control Center document contains:

1. A first-focusable “Skip to content” link targeting the real `main` element.
2. A `header` landmark with product name and bounded global status.
3. One named primary `nav` in wide mode, or one Menu button controlling a named navigation drawer in narrow mode.
4. One `main` landmark and exactly one H1 for the active route.
5. H2/H3 headings in logical hierarchy without skipped levels used for styling.
6. Separate status regions for progress, success, and error.

Route changes update document title, `aria-current="page"`, and the H1, then focus the H1 with `tabindex="-1"`. A route change is not redundantly announced through a live region. Every `aria-controls` points to the ID of the element actually controlled, never to a heading standing in for a panel.

The compact sidebar has one visible H1, H2 block headings, and no duplicate settings navigation. Native elements are preferred over reconstructed ARIA widgets.

## 2. Keyboard order and interaction

Control Center tab order is:

1. Skip link.
2. Header actions, including visible AUTO kill switch when active.
3. Primary navigation in wide mode, or Menu button in narrow mode.
4. H1/main controls in reading order.
5. Route status and actions.
6. Footer/status links, if present.

There is no positive `tabindex`, CSS `order` that contradicts DOM order, keyboard trap outside an active dialog, or hover-only action. `Tab`, `Shift+Tab`, `Enter`, and `Space` retain native behavior. Ordinary navigation is not converted into a custom arrow-key widget. All pointer targets are at least 44 by 44 CSS px, with sufficient separation to prevent accidental activation.

## 3. Focus visibility and persistence

- Every interactive element has a focus indication visible against adjacent colors, using `--vscode-focusBorder` or forced-color system tokens.
- Focus is not removed by CSS and is not indicated by color alone.
- State refreshes do not steal focus. A revision may move focus only for an explicit route change, overlay open/close, validated deep link, attempted invalid form submission, or native-prompt return.
- Home waits for its same-revision setup projection. Each setup control exposes a textual Complete/Needs attention/Pending equivalent, while `aria-current="step"` identifies the selected panel separately; reload uses the host recommendation and never assumes Step 1 before state arrives.
- The Commands/authority setup marker describes host system readiness only. Its Complete text is never an Auto, pending-action, consent, or review approval, and navigating to Commands/Privacy grants nothing.
- Built-in Commands preserve in-session focus by a validated stable `commandId`; it is never persisted. A pending custom review uses the fixed host-projected `pending-custom-review` target, also never persisted. Filter/page changes move to the first result or empty heading; row removal or expired pending state falls back to the results heading or Commands H1.
- Reload/reveal uses host-owned `ready/snapshot/ack`; stale revisions cannot move focus.
- Panel/sidebar disposal clears browser focus handles and never dispatches or approves an operation.

## 4. Live-region policy

One meaningful change produces one announcement.

| Event | Region/pattern | Politeness | Rule |
|---|---|---|---|
| Route change | Focused H1 and updated title | None | Do not duplicate in live region |
| Setup projection | Setup progress/status | Polite | Announce the recommended step or all-complete summary once; do not announce every unchanged marker |
| Mic state | Mic status region | Polite | Announce start/stop/ready once |
| Partial transcript | Transcript status | Polite | Only with `streamingPartials`; debounce/coalesce; never dispatch |
| Final transcript | Transcript result | Polite | Mark explicitly Final; one final event |
| Command result count | Commands results status | Polite | “N results, page X of Y” once per accepted revision |
| Long operation progress | Progress status | Polite | Announce meaningful phase/percentage thresholds, not every frame |
| Success | Success status | Polite | State the completed safe outcome once |
| New error | Error status/alert | Assertive once | Do not keep `role=alert` on rerendered static errors |
| Dialog open | Dialog name/description semantics | None | Avoid global duplicate announcement |
| Native prompt result | Success/error status after snapshot | Polite/assertive by severity | Do not compete with route change |

Download progress is a reserved future local-speech contract and has no Wave 1 event or region content.

## 5. Forms and errors

- Every input has a persistent visible label. Placeholder text is optional guidance, never the only label.
- Required/optional status is textual and programmatic.
- Help and error text are connected with `aria-describedby` or `aria-errormessage`.
- On invalid submit, an error summary identifies the problem; focus goes to the summary, and each item targets its field.
- Validation does not erase entered non-secret data without notice. Secrets are entered only through VS Code-owned credential UI and never returned to the webview.
- Command edit forms expose phrases, label/description, enabled, and reset. Built-in executor ID and typed slot schema are read-only and cannot be submitted as overrides.
- Custom commands use visible bounded fields for label, optional description, 1–20 unique phrase lines, allowed kind/target, enabled state, and Agent Mode availability. There is no raw-JSON wizard in the Control Center.

## 6. Commands table and pagination

- Page size is exactly 25; no virtualization.
- Use native table semantics when columns are tabular. A narrow stacked presentation must retain a coherent name/role/value relationship and DOM order.
- `aria-rowcount` equals the filtered result count. Row position, current page, and total pages are exposed textually.
- Search covers HE/EN label, phrase, and ID; it has a visible label and a clear action.
- Seven category filters and the Enabled/Changed filters expose selected state programmatically and textually.
- Pagination buttons have explicit Previous/Next labels and disabled state at boundaries.
- Empty results provide a heading, explain active filters, and offer Clear filters.
- The live region announces count/page once and does not read all 25 rows.

## 7. Provider capabilities and honest status

UI availability comes only from the host capability snapshot.

- Provider `none`: display “Not configured”; make zero speech network requests.
- Soniox: partial UI is rendered only for `streamingPartials=true`. The browser only requests a host-owned native remote-processing prompt; explicit native confirmation creates a machine-local receipt bound to Soniox, active profile, endpoint-policy/consent versions, and epoch. SecretStorage plus the receipt are atomically rechecked immediately before connection. Revoke or credential/provider/profile/policy change aborts the socket and invalidates readiness.
- Partial and final are differentiated by text, not color alone. Partial cannot reach matcher or dispatch.
- System TTS: always label **“System voice — temporary and OS-dependent.”** `configured-unverified` means the current browser has not yet reported bounded OS voice evidence and is never ready: setup exposes Pending while the choice marker is undecided, then Needs attention after explicit `system`. Missing OS voices is an unavailable-capability message, not a silent fallback. Voice observation is presentation evidence only and never action authority.
- Offline/local speech: explicitly say in both languages that it is planned and pending but is not included or available in this version. This nonclaim has no download/install/retry/repair CTA and never implies local/offline/keyless readiness. Keep OS-dependent system speech as a separate sentence.

When effective Auto is on, `AUTO` status and an immediate labelled kill switch appear on Home, Voice, Commands, sidebar, and status bar. Enabling is never a simple ARIA switch: the DOM explanation closes before a native VS Code warning, and only explicit native confirmation can change authority. The native result is consumed once only after the host revalidates its private nonce/epoch, policy, profile, trust/focus/panel generation, and exact target/action fingerprint. Disabling is immediate and does not require confirmation.

## 8. RTL/LTR and international text

- Hebrew snapshots set `lang="he" dir="rtl"`; English sets `lang="en" dir="ltr"`.
- Use logical properties (`margin-inline`, `padding-inline`, `inset-inline`, `border-inline`, logical sizes) rather than left/right assumptions.
- DOM and tab order are identical in both languages. Do not reverse with flex/grid order.
- Directional navigation arrows may mirror; mic, warning, provider, status, and Git symbols do not.
- Branches, paths, command IDs, shortcuts, and mixed-language phrases use `bdi` or `dir="auto"`. Code values use LTR presentation without reversing punctuation.
- Translations preserve action meaning and risk. Do not shorten away “remote processing”, “temporary”, or “OS-dependent”.

## 9. Reflow, zoom, and text resilience

Acceptance is required at 320 CSS px viewport width and at 200% browser/text zoom:

- no horizontal scroll for the page or dialog;
- no clipped text, control, error, status, or focused target;
- navigation becomes one drawer and content becomes one column;
- action bars do not cover content;
- labels wrap without disconnecting from their controls;
- long unbroken technical values wrap or offer an accessible reveal/copy path;
- Close, Cancel, kill switch, and primary actions remain reachable;
- zoom does not remove content or require pointer-only panning.

Breakpoints are selected by content fit, not device names. A layout changes before overlap occurs.

## 10. Color, contrast, and high contrast

- Use VS Code semantic color tokens rather than a fixed light/dark palette.
- Normal text meets 4.5:1 contrast; large text meets 3:1; component boundaries and focus indicators meet 3:1 against adjacent colors.
- Error, warning, ready, partial/final, selected, disabled, and AUTO states use text/icon/shape as well as color.
- In forced-colors/high-contrast modes, retain borders, focus, selected state, disabled distinction, and icon visibility using system colors and `forced-color-adjust` only where justified.
- Disabled controls remain legible and have an adjacent reason; unavailable actions are not merely low-opacity mystery controls.

## 11. Motion and timing

- Respect `prefers-reduced-motion: reduce` and remove nonessential movement, parallax, pulse, shimmer, and smooth scrolling.
- Skeleton loading does not flash or animate under reduced motion.
- Focus movement never waits for an animation.
- Status/transcript changes do not move the currently focused control.
- Timeouts do not dismiss errors, consent explanations, or confirmation previews before the user can read them. Native prompt cancellation/dismissal is safe and grants nothing.

## 12. Overlay and screen-reader acceptance

All modal/drawer requirements in `overlay-focus-contract.md` are mandatory: one overlay, `role="dialog"`, `aria-modal="true"`, visible labelled heading, safe initial focus, focus trap, inert background, Escape, visible Close, and documented return fallback. No DOM overlay remains beneath a native prompt.

Manual assistive-technology checks:

| Platform | Reader | Required result |
|---|---|---|
| Windows | NVDA | Routes, table counts, dialogs, errors, partial/final, and Auto state are announced once and in context |
| macOS | VoiceOver | Landmarks and rotor headings are coherent; modal traversal cannot reach background |
| Linux | Orca, when available | Navigation, dialog trap/return, form errors, and status changes are usable |

Automated accessibility checks supplement but do not replace keyboard and screen-reader verification.

## 13. Security-relevant accessibility boundaries

- Webview messages containing `confirmed`, `approved`, receipt, nonce, effective Auto, consent grant, or action outcome are rejected; accessibility APIs cannot become an authority bypass.
- Pending-review activation is payload-free. The host resolves the current pending action and projects the custom-review focus target; the browser cannot submit a pending/mapping ID or authority token.
- Host-to-webview payloads never include credentials, secrets, paths, receipts, nonces, profile/installation identity, internal fingerprints/target snapshots, raw arguments, or private Git messages. Operation IDs, transcript text, focus targets, strings, objects, properties, and arrays use the closed bounds in `protocol-state-matrix.md`.
- Accessible labels never expose secrets, full private paths, raw command arguments, or authority receipts.
- Dynamic text uses safe DOM APIs, not HTML interpolation.
- An error or unavailable state never offers a misleading local/download CTA.
- Native Git credential/conflict/protected-branch prompts stay native and remain in force when Auto is enabled.

## 14. Verification checklist

- [ ] Keyboard-only traversal and operation for every route, setup step, sidebar control, table page, drawer, modal, and recovery action.
- [ ] Setup Complete/Needs attention/Pending and Current meanings are textual/programmatic, survive RTL/LTR, and reconstruct without a color-only distinction.
- [ ] One H1 per route, correct landmarks, title, `aria-current`, skip link, and real `aria-controls` targets.
- [ ] Focus is visible, stable, returned correctly, and protected from stale revisions.
- [ ] Live announcements are single, bounded, and non-competing.
- [ ] Commands pagination is 25 with filtered `aria-rowcount` and focus persistence.
- [ ] 320 CSS px and 200% zoom pass without horizontal overflow or hidden actions.
- [ ] HE/RTL and EN/LTR preserve DOM/tab order and mixed-text readability.
- [ ] High contrast and reduced motion retain meaning and focus.
- [ ] NVDA, VoiceOver, and Orca-when-available checks are recorded.
- [ ] Provider capabilities, AUTO badge/kill switch, and system TTS label are truthful.
- [ ] Native consent/authority results are one-shot, host-bound, immediately revalidated, and invalidated on credential/consent/profile/trust/focus/panel context change.
- [ ] No local/download CTA or local/offline/keyless capability claim exists.
