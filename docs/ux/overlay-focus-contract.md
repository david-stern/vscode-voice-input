# Overlay and focus contract

**Status:** frozen for Wave 1 implementation

**Invariant:** at most one DOM overlay exists at a time, and no DOM overlay remains open beneath a native VS Code prompt.

## 1. Allowed overlays

Wave 1 DOM modals are limited to:

1. Auto Mode enable explanation and warning.
2. Preview of an extension-owned, confirmation-required action while Auto is off.

Wave 1 drawers are limited to:

1. Built-in command edit/reset and read-only slot/availability details.
2. Advanced provider/endpoint details; credentials remain VS Code-owned.
3. Primary navigation at narrow widths.

Download consent and local model installation are reserved for the blocked future local track and must not be opened, linked, or represented in Wave 1. Drawers are secondary context, not alternate routes. There is no modal over a drawer, drawer inside a modal, stacked drawer, or nested dialog.

## 2. Single-overlay state machine

```text
CLOSED
  | open allowed modal(trigger, kind)
  v
DOM_MODAL
  | cancel / Escape / Close        -> CLOSED + normal focus return
  | continue to native prompt      -> close + remove inert -> NATIVE_PENDING

CLOSED
  | open allowed drawer(trigger, kind)
  v
DRAWER
  | save / cancel / Escape / Close -> CLOSED + normal focus return
  | request native prompt          -> close + remove inert -> NATIVE_PENDING

NATIVE_PENDING
  | host result + new snapshot + focusTarget
  v
CLOSED + deferred focus return after render, before ack
```

An open request while not `CLOSED` is not stacked. The controller either rejects it or completes deterministic close cleanup before accepting the next request. It never leaves two elements with `aria-modal=true`.

## 3. Required dialog semantics

Every modal and drawer overlay has:

- `role="dialog"` and `aria-modal="true"`;
- an accessible name via `aria-labelledby` pointing to a visible heading;
- optional `aria-describedby` for concise consequences, never the entire long form;
- a visible Close button at a stable location;
- a focus trap that includes all and only active overlay controls;
- background `inert`, with a tested equivalent fallback when native `inert` is unavailable;
- an initially focused safe control;
- `Escape` to cancel when cancellation is legal;
- no requirement to click outside; outside click alone never closes or confirms.

If a blocking operation truly cannot be cancelled after host dispatch, Escape and Close remain present but clearly move to a safe “close view, operation continues” behavior; they never imply cancellation succeeded.

## 4. Initial focus

| Overlay | Initial focus | Rationale |
|---|---|---|
| Auto explanation modal | Cancel / Keep Auto off | Safest reversible choice |
| Confirmation-required action preview | Keep pending | Safest reversible choice; neither cancels nor requests native confirmation |
| Command edit drawer | Drawer heading, then first editable phrase through Tab | Allows context before edits |
| Provider details drawer | Drawer heading, then first safe non-secret field | Credentials are not DOM fields |
| Narrow navigation drawer | Current route item | Preserves orientation |

Initial focus never lands on a destructive/confirm button solely because it is first in DOM. The dialog container may receive `tabindex="-1"` only when the content itself must be read before controls.

## 5. Normal focus return

On close without a native prompt, return focus in this order:

1. Original trigger, if connected, visible, enabled, and still valid.
2. Stable row identified by a transient, host-validated `commandId` for built-in command drawers.
3. Fixed `pending-custom-review` target for a current host-owned custom review.
4. Section or results heading associated with the removed trigger.
5. Current route H1.

The trigger is stored in memory as a semantic ID plus bounded context, not as an untrusted CSS selector or raw element HTML, and it is never persisted. If a filter/page update removed the command row or the host-owned custom pending review expired, use the results heading/H1 fallback. Route changes use the new route H1, not the previous trigger.

## 6. Native prompt handoff

The DOM is explanation/preview only. It is not an authority boundary.

1. User activates Continue in the DOM modal.
2. The webview closes the modal, removes the focus trap and `inert`, and sends an intent without `confirmed`, receipt, nonce, or action outcome.
3. The Extension Host calls `vscode.window.showWarningMessage(message, { modal: true }, confirmAction)`.
4. Before the call, the host creates a cryptographically random, host-only pending nonce and prompt epoch bound to the exact prompt kind, policy/consent/authority versions, profile/installation, trust/focus/panel generation, and—for an action—the exact action fingerprint, typed-argument digest, executor/risk, and target snapshot.
5. Only the explicit confirm result received by the host may be consumed, once, after immediate revalidation reproduces every binding. The record is marked consumed before creating an Auto receipt or permitting dispatch.
6. Toggle, consent/credential/profile/trust/focus/panel-generation change, pending/action change, cancel, dismiss, timeout, panel close, forged message, or replay invalidates the record, leaves authority unchanged, and dispatches nothing.
7. The host reveals the canonical panel if needed and sends a new `stateSnapshot(revision, ..., focusTarget)`.
8. The webview renders, returns focus to the semantic target/fallback, then sends `ack(revision)`.

No DOM overlay is open while the native prompt is active. The browser never paints Auto on before the host reports effective state. Native Git credential, conflict, and protected-branch prompts remain owned by VS Code/Git and are never duplicated in a DOM overlay.

## 7. Keyboard contract

- `Tab` advances within the overlay and wraps from last to first interactive element.
- `Shift+Tab` wraps from first to last.
- `Escape` performs the documented cancellation/close path and never confirms.
- `Enter` activates only the focused native button; there is no global default-confirm shortcut.
- `Space` follows native button/checkbox behavior.
- No positive `tabindex`, focus sentinel exposed to accessibility APIs, or arrow-key model for ordinary forms.
- Opening/closing does not scroll the background. After focus return, the target is scrolled into view without unnecessary animation.

## 8. Screen-reader and live-region contract

- Opening a dialog announces its role, visible title, and short description through semantics, not a competing global live region.
- Background landmarks are unreachable and absent from the accessibility traversal while inert.
- Validation errors are linked with `aria-describedby`/`aria-errormessage`; summary focus moves only after an attempted submission.
- Closing normally does not generate an extra “closed” live message when focus return already supplies context.
- Native prompt result is announced once by the appropriate success/error status region after the host snapshot. It does not compete with route-change or overlay-open announcements.
- NVDA on Windows, VoiceOver on macOS, and Orca on Linux when available must announce title and decision, keep traversal inside, and return to the documented target.

## 9. RTL, responsive, contrast, and motion

- Drawer side uses logical `inset-inline-start/end`; DOM and keyboard order are unchanged in RTL.
- At 320 CSS px and 200% zoom, the overlay fits the viewport, its body scrolls vertically, Close remains reachable, and no horizontal scroll is needed.
- Dialog width uses a bounded logical maximum and viewport padding; form controls never overflow.
- Focus outlines use VS Code focus tokens and remain visible in high-contrast/forced-colors modes.
- Under reduced motion, opening and closing are immediate or use a minimal opacity change; focus never waits for animation completion.

## 10. Failure and disposal behavior

- If opening fails, keep focus on the trigger and announce one content-free error.
- If the panel reloads or disposes, overlay state is discarded. A modal/drawer is never restored.
- Pending native authority remains host-owned; panel disposal cannot turn dismissal into confirmation.
- Panel reload/adoption/disposal increments the panel generation and invalidates any pending native prompt; an old callback cannot affect the new panel generation.
- If the trigger disappears while the native prompt is open, the host focus target resolves to the documented row/heading/H1 fallback.
- A stale focus-return revision is ignored and cannot move focus away from a newer route.

## 11. Acceptance checklist

- [ ] Exactly one of `CLOSED`, `DOM_MODAL`, `DRAWER`, or `NATIVE_PENDING` is active.
- [ ] Only the two allowed modal purposes and three allowed drawer purposes are reachable.
- [ ] Accessible name, modal semantics, trap, inert, visible Close, safe initial focus, Escape, and return fallback are verified.
- [ ] Action preview opens on Keep pending; neither opening nor initial focus cancels, confirms, or dispatches.
- [ ] DOM closes before native prompt; only native explicit confirmation changes authority.
- [ ] Native results are bound to a host-only nonce/epoch and exact policy/fingerprint/target snapshot, consumed once after immediate revalidation, and invalidated by every context change.
- [ ] Focus returns after the host snapshot and before ack.
- [ ] 320 px, 200% zoom, RTL/LTR, high contrast, reduced motion, and screen readers are covered.
- [ ] No download/local modal or CTA exists in Wave 1.
