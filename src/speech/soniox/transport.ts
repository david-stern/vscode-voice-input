export const SONIOX_REALTIME_ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';

export interface SonioxTransportOpenEvent {
  readonly type: 'open';
}

export interface SonioxTransportMessageEvent {
  readonly type: 'message';
  readonly data: unknown;
}

export interface SonioxTransportErrorEvent {
  readonly type: 'error';
}

export interface SonioxTransportCloseEvent {
  readonly type: 'close';
  readonly code?: number;
  readonly wasClean?: boolean;
}

export interface SonioxWebSocketTransport {
  readonly readyState: number;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: (event: SonioxTransportOpenEvent) => void): void;
  addEventListener(type: 'message', listener: (event: SonioxTransportMessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: SonioxTransportErrorEvent) => void): void;
  addEventListener(type: 'close', listener: (event: SonioxTransportCloseEvent) => void): void;
  removeEventListener(type: 'open', listener: (event: SonioxTransportOpenEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: SonioxTransportMessageEvent) => void): void;
  removeEventListener(type: 'error', listener: (event: SonioxTransportErrorEvent) => void): void;
  removeEventListener(type: 'close', listener: (event: SonioxTransportCloseEvent) => void): void;
}

/** Coordinator-owned adapter point; this lane intentionally selects no concrete WebSocket package. */
export type SonioxWebSocketTransportFactory = (
  endpoint: string,
) => SonioxWebSocketTransport;
