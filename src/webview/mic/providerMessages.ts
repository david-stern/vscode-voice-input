import { parseWebviewMessage, type WebviewMessage } from '../protocol';
import {
  parseCompactMicBrowserMessage,
  type CompactMicBrowserMessage,
} from './compactContracts';

export type MicProviderInboundMessage =
  | { kind: 'compact'; message: CompactMicBrowserMessage }
  | { kind: 'legacy-safe'; message: WebviewMessage };

/** Closed provider boundary for browser messages before any host callback runs. */
export function parseMicProviderInboundMessage(value: unknown): MicProviderInboundMessage | undefined {
  const compact = parseCompactMicBrowserMessage(value);
  if (compact) return { kind: 'compact', message: compact };
  const legacySafe = parseWebviewMessage(value);
  return legacySafe ? { kind: 'legacy-safe', message: legacySafe } : undefined;
}
