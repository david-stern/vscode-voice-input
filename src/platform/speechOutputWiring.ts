import { spawn } from 'node:child_process';

import type { CredentialService, SettingsRepository } from '../config';
import type { SpeechDeliveryPort } from '../features/assistant';
import type { NativeLocalize } from './nativeLocalization';
import { SonioxTtsCoordinator } from './sonioxTtsCoordinator';
import {
  SonioxTtsService,
  type SonioxPlaybackProcess,
  type SonioxPlaybackSpawn,
  type SonioxTtsAuthority,
  type SonioxTtsFetch,
  type SonioxTtsResponse,
} from './sonioxTtsService';
import { createHostSpeechWiring, type HostSpeechDelivery } from './systemSpeechDelivery';
import type { SystemSpeechHost } from './systemSpeechHost';

export interface SonioxSpeechAuthorityPort extends SonioxTtsAuthority {
  /** Closing consent, rotating the key, or changing provider drops the roster. */
  onDidInvalidate?(listener: () => void): { dispose(): void };
}

export interface SpeechOutputWiringOptions {
  browser: SpeechDeliveryPort;
  settings: Pick<SettingsRepository, 'read'>;
  credentials: Pick<CredentialService, 'use'>;
  authority: SonioxSpeechAuthorityPort;
  localize: NativeLocalize;
  log(message: string): void;
  publish(): void;
  onFinished(id: string, outcome: string): void;
  fetch?: SonioxTtsFetch;
  spawnPlayback?: SonioxPlaybackSpawn;
}

export interface SpeechOutputWiring {
  readonly host: SystemSpeechHost;
  readonly soniox: SonioxTtsCoordinator;
  readonly delivery: HostSpeechDelivery;
  dispose(): void;
}

/**
 * Composes every speech-output path the host owns: the probed speech-dispatcher fallback,
 * the consent-gated Soniox voice path, and the router that prefers the selected voice and
 * falls back rather than going silent.
 */
export function createSpeechOutputWiring(
  options: SpeechOutputWiringOptions,
): SpeechOutputWiring {
  const service = new SonioxTtsService({
    fetch: options.fetch ?? nodeFetch,
    // stdin-only playback: no spoken text ever reaches argv, a shell, or a temp file.
    spawn: options.spawnPlayback ?? spawnPlaybackProcess,
    credentials: options.credentials,
    authority: options.authority,
    log: options.log,
  });
  const soniox = new SonioxTtsCoordinator({
    service,
    settings: options.settings,
    publish: options.publish,
  });
  const subscription = options.authority.onDidInvalidate?.(() => soniox.invalidate());
  const speech = createHostSpeechWiring({
    browser: options.browser,
    settings: options.settings,
    localize: options.localize,
    log: options.log,
    publish: options.publish,
    onFinished: options.onFinished,
    soniox,
  });
  return {
    host: speech.host,
    soniox,
    delivery: speech.delivery,
    dispose: () => {
      subscription?.dispose();
      soniox.dispose();
      service.dispose();
      speech.host.dispose();
    },
  };
}

/** Adapts the platform `fetch` to the bounded response shape the service consumes. */
const nodeFetch: SonioxTtsFetch = async (input, init) => {
  const response = await fetch(input, init);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<unknown>,
    body: response.body ? readStream(response.body) : null,
  } satisfies SonioxTtsResponse;
};

async function* readStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array, void, undefined> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    // Cancelling releases the socket when playback stops before the stream ends.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** One argv array, no shell, and stdin-only audio: spoken text never becomes a command. */
export const spawnPlaybackProcess: SonioxPlaybackSpawn = (command, args) => (
  spawn(command, [...args], {
    stdio: ['pipe', 'ignore', 'ignore'],
  }) as unknown as SonioxPlaybackProcess
);
