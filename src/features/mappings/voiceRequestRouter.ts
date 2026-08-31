import { isConfirmCustomActionPhrase, type CustomMapping } from '../../assistant';
import type { TargetSnapshot } from '../../assistant/context';

export interface VoiceMappingRequestPort {
  matchPhrase(postWakeText: string): CustomMapping | undefined;
  request(mapping: CustomMapping, snapshot: TargetSnapshot, utteranceId: string): void;
  confirm(confirmationId: string): Promise<void>;
  cancel(announce?: boolean): void;
}

/**
 * Routes local mapping authority before any optional remote planning.
 * `handled: false` is the only result that permits the caller to use DeepSeek.
 */
export async function routeVoiceMappingRequest(
  postWakeText: string,
  snapshot: TargetSnapshot,
  utteranceId: string,
  mappings: VoiceMappingRequestPort,
): Promise<{ handled: boolean; kind: 'confirmation' | 'mapping' | 'unmatched' }> {
  if (isConfirmCustomActionPhrase(postWakeText)) {
    await mappings.confirm(utteranceId);
    return { handled: true, kind: 'confirmation' };
  }

  const mapping = mappings.matchPhrase(postWakeText);
  if (mapping) {
    mappings.request(mapping, snapshot, utteranceId);
    return { handled: true, kind: 'mapping' };
  }

  mappings.cancel(false);
  return { handled: false, kind: 'unmatched' };
}
