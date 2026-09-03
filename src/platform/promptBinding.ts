import { createHash } from 'node:crypto';

import type { TargetSnapshot } from '../assistant/context';

/** Full snapshot fingerprint, including capture time and window focus. */
export function targetFingerprint(snapshot: TargetSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

/**
 * Binds target identity across a native modal. Window focus and capture time are normalized
 * because the modal blurs the window it belongs to and every capture carries a fresh
 * timestamp; either would make the binding unequal with itself. Requested/resolved/focused
 * target kind and tab, editor, and terminal identity are all still bound.
 */
export function promptTargetFingerprint(snapshot: TargetSnapshot): string {
  return targetFingerprint({ ...snapshot, vscodeFocused: true, capturedAt: 0 });
}

/**
 * Binds a target across the Auto Mode dispatch boundary, where no modal is involved. Only
 * the capture timestamp is normalized: every capture carries a fresh one, so leaving it in
 * makes the recheck fail even when the target never moved. Window focus stays bound here.
 */
export function autoDispatchTargetFingerprint(snapshot: TargetSnapshot): string {
  return targetFingerprint({ ...snapshot, capturedAt: 0 });
}

/**
 * Host authority binding for builtin voice actions, re-compared after the native modal.
 * Window focus is deliberately not an input for the same reason.
 */
export function builtinAuthorityFingerprint(
  binding: { panelGeneration: number; workspaceTrusted: boolean },
): string {
  const { panelGeneration, workspaceTrusted } = binding;
  if (!Number.isSafeInteger(panelGeneration) || panelGeneration < 0) return '';
  return createHash('sha256')
    .update(JSON.stringify({ panelGeneration, workspaceTrusted }))
    .digest('hex');
}
