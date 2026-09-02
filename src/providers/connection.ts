import {
  providerConsentRequired,
  providerRequiresCredential,
  type ConsentInvalidation,
  type ConsentService,
  type CredentialInvalidation,
  type CredentialService,
  type ProviderId,
  type ProviderProfile,
  type SettingsRepository,
} from '../config';
import { getProviderDescriptor, type ProviderId as PlannerProviderId } from '../inference';
import type {
  SonioxConnectionAuthority,
  SonioxConnectionAuthorityPort,
} from '../speech/providerRegistry';
import {
  SONIOX_REALTIME_ENDPOINT,
  type SonioxTransportCloseEvent,
  type SonioxTransportErrorEvent,
  type SonioxTransportMessageEvent,
  type SonioxTransportOpenEvent,
  type SonioxWebSocketTransport,
  type SonioxWebSocketTransportFactory,
} from '../speech/soniox/transport';
import WebSocket from 'ws';

export const CONNECTION_TEST_CATEGORIES = [
  'connected',
  'not-configured',
  'consent-required',
  'unauthorized',
  'rate-limited',
  'rejected',
  'unavailable',
  'timed-out',
  'cancelled',
] as const;

export type ConnectionTestCategory = (typeof CONNECTION_TEST_CATEGORIES)[number];

export interface ConnectionTestResult {
  provider: ProviderId;
  category: ConnectionTestCategory;
}

export interface ConnectionProbe {
  probe(
    credential: string | undefined,
    signal?: AbortSignal,
    profile?: Readonly<ProviderProfile>,
  ): Promise<ConnectionTestCategory>;
}

export type ConnectionTestCompletion =
  | { revision: number; publish: true; result: ConnectionTestResult }
  | { revision: number; publish: false };

interface DisposableSubscription {
  dispose(): void;
}

type ObservableConsent = Pick<ConsentService, 'status'> & Partial<Pick<ConsentService, 'onDidRevoke'>>;
type ObservableCredentials = Pick<CredentialService, 'use' | 'useOptional'>
  & Partial<Pick<CredentialService, 'onDidInvalidate'>>;
type ObservableSettings = Pick<SettingsRepository, 'read'>
  & Partial<Pick<SettingsRepository, 'onProviderAuthorityChanged' | 'providerChangePending'>>;

export interface ConnectionTestServiceOptions {
  credentials: ObservableCredentials;
  consent: ObservableConsent;
  probes: Partial<Readonly<Record<ProviderId, ConnectionProbe>>>;
  settings?: ObservableSettings;
  sonioxAuthority?: SonioxConnectionAuthorityPort;
}

/** Runs explicit, transcript-free tests and never exposes a credential to callers. */
export class ConnectionTestService {
  private readonly active = new Map<ProviderId, Set<AbortController>>();
  private readonly subscriptions: DisposableSubscription[] = [];

  constructor(private readonly options: ConnectionTestServiceOptions) {
    const consentSubscription = options.consent.onDidRevoke?.(
      (event: ConsentInvalidation) => this.cancelForConsent(event),
    );
    if (consentSubscription) this.subscriptions.push(consentSubscription);
    const credentialSubscription = options.credentials.onDidInvalidate?.(
      (event: CredentialInvalidation) => this.cancel(event.provider),
    );
    if (credentialSubscription) this.subscriptions.push(credentialSubscription);
    const settingsSubscription = options.settings?.onProviderAuthorityChanged?.(
      () => this.cancel(),
    );
    if (settingsSubscription) this.subscriptions.push(settingsSubscription);
    const sonioxAuthoritySubscription = options.sonioxAuthority?.onDidInvalidate?.(
      () => this.cancel('soniox'),
    );
    if (sonioxAuthoritySubscription) this.subscriptions.push(sonioxAuthoritySubscription);
  }

  async test(provider: ProviderId, callerSignal?: AbortSignal): Promise<ConnectionTestResult> {
    const probe = this.options.probes[provider];
    if (!probe) return result(provider, 'unavailable');
    const profile = provider === 'soniox' ? undefined : this.profile(provider);
    if (profile && !profile.enabled) return result(provider, 'rejected');
    if (this.options.settings?.providerChangePending) return result(provider, 'cancelled');
    if (profile && this.consentRequired(provider, profile) && !this.consentGranted(provider)) {
      return result(provider, 'consent-required');
    }
    let sonioxAuthority: SonioxConnectionAuthority | undefined;

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    this.track(provider, controller);
    const profileSignature = profile ? signature(profile) : undefined;
    try {
      const category = await this.options.credentials.useOptional(
        provider,
        async (credential) => {
          if (profile && this.consentRequired(provider, profile) && !this.consentGranted(provider)) {
            return 'consent-required' as const;
          }
          if (controller.signal.aborted) return 'cancelled' as const;
          if (providerRequiresCredentialForProfile(provider, profile) && !credential) {
            return 'not-configured' as const;
          }
          if (provider === 'soniox') {
            sonioxAuthority = await this.captureSonioxAuthority();
            if (!sonioxAuthority) return 'consent-required' as const;
          }
          if (!await this.authorityStillCurrent(provider, profileSignature, sonioxAuthority)) {
            return 'cancelled' as const;
          }
          const category = await probe.probe(credential, controller.signal, profile);
          if (controller.signal.aborted) return 'cancelled' as const;
          return await this.authorityStillCurrent(provider, profileSignature, sonioxAuthority)
            ? category
            : 'cancelled' as const;
        },
      );
      if (category === undefined) return result(provider, 'not-configured');
      if (controller.signal.aborted) return result(provider, 'cancelled');
      return result(provider, category);
    } catch {
      return result(provider, controller.signal.aborted ? 'cancelled' : 'unavailable');
    } finally {
      callerSignal?.removeEventListener('abort', abortFromCaller);
      this.untrack(provider, controller);
    }
  }

  cancel(provider?: ProviderId): void {
    const targets = provider === undefined
      ? [...this.active.values()].flatMap((controllers) => [...controllers])
      : [...(this.active.get(provider) ?? [])];
    for (const controller of targets) controller.abort();
  }

  dispose(): void {
    this.cancel();
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
  }

  private profile(provider: PlannerProviderId): Readonly<ProviderProfile> {
    return this.options.settings?.read().values.providerProfiles[provider] ?? {
      endpoint: getProviderDescriptor(provider).defaultEndpoint,
      model: getProviderDescriptor(provider).defaultModel,
      enabled: true,
    };
  }

  private consentRequired(
    provider: ProviderId,
    profile: Readonly<ProviderProfile>,
  ): provider is PlannerProviderId {
    return provider !== 'soniox' && providerConsentRequired(provider, profile.endpoint);
  }

  private consentGranted(provider: ProviderId): boolean {
    return provider !== 'soniox' && this.options.consent.status(provider).acknowledged;
  }

  private async authorityStillCurrent(
    provider: ProviderId,
    expectedProfile: string | undefined,
    sonioxAuthority?: SonioxConnectionAuthority,
  ): Promise<boolean> {
    if (this.options.settings?.providerChangePending) return false;
    if (provider === 'soniox') {
      return Boolean(
        sonioxAuthority
        && await this.options.sonioxAuthority?.revalidate(sonioxAuthority),
      );
    }
    const profile = this.profile(provider);
    return profile.enabled && signature(profile) === expectedProfile;
  }

  private async captureSonioxAuthority(): Promise<SonioxConnectionAuthority | undefined> {
    try {
      return await this.options.sonioxAuthority?.capture();
    } catch {
      return undefined;
    }
  }

  private cancelForConsent(event: ConsentInvalidation): void {
    if (event.id === 'assistant-listening') return;
    this.cancel(event.id);
  }

  private track(provider: ProviderId, controller: AbortController): void {
    const controllers = this.active.get(provider) ?? new Set<AbortController>();
    controllers.add(controller);
    this.active.set(provider, controllers);
  }

  private untrack(provider: ProviderId, controller: AbortController): void {
    const controllers = this.active.get(provider);
    controllers?.delete(controller);
    if (controllers?.size === 0) this.active.delete(provider);
  }
}

/** Allows a UI/controller to publish only the newest asynchronous test completion. */
export class ConnectionTestController {
  private revision = 0;
  private currentAbort: AbortController | undefined;

  constructor(private readonly service: Pick<ConnectionTestService, 'test'>) {}

  get currentRevision(): number {
    return this.revision;
  }

  async run(provider: ProviderId): Promise<ConnectionTestCompletion> {
    this.currentAbort?.abort();
    const controller = new AbortController();
    this.currentAbort = controller;
    const revision = ++this.revision;
    const testResult = await this.service.test(provider, controller.signal);
    if (revision !== this.revision) return { revision, publish: false };
    this.currentAbort = undefined;
    return { revision, publish: true, result: testResult };
  }

  cancel(): number {
    this.currentAbort?.abort();
    this.currentAbort = undefined;
    this.revision += 1;
    return this.revision;
  }
}

function providerRequiresCredentialForProfile(
  provider: ProviderId,
  profile: Readonly<ProviderProfile> | undefined,
): boolean {
  if (provider !== 'ollama') return providerRequiresCredential(provider);
  return profile === undefined || providerConsentRequired(provider, profile.endpoint);
}

function signature(profile: Readonly<ProviderProfile>): string {
  return JSON.stringify([profile.endpoint, profile.model, profile.enabled]);
}

function result(provider: ProviderId, category: ConnectionTestCategory): ConnectionTestResult {
  return Object.freeze({ provider, category });
}

/** Small audited Node transport: no redirects, compression, native addon, or browser exposure. */
export function createSonioxWebSocketTransportFactory(): SonioxWebSocketTransportFactory {
  return (endpoint) => {
    if (endpoint !== SONIOX_REALTIME_ENDPOINT) throw new TypeError('Soniox endpoint is not allowlisted');
    return new NodeSonioxWebSocketTransport(new WebSocket(endpoint, {
      followRedirects: false,
      perMessageDeflate: false,
      maxPayload: 64 * 1_024,
    }));
  };
}

type SonioxEventMap = {
  open: SonioxTransportOpenEvent;
  message: SonioxTransportMessageEvent;
  error: SonioxTransportErrorEvent;
  close: SonioxTransportCloseEvent;
};

class NodeSonioxWebSocketTransport implements SonioxWebSocketTransport {
  private readonly adapters = new Map<string, Map<object, (event: unknown) => void>>();

  constructor(private readonly socket: WebSocket) {}

  get readyState(): number { return this.socket.readyState; }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  addEventListener<K extends keyof SonioxEventMap>(
    type: K,
    listener: (event: SonioxEventMap[K]) => void,
  ): void {
    const byListener = this.adapters.get(type) ?? new Map<object, (event: unknown) => void>();
    if (byListener.has(listener)) return;
    const adapter = (event: unknown) => listener(projectWsEvent(type, event) as SonioxEventMap[K]);
    byListener.set(listener, adapter);
    this.adapters.set(type, byListener);
    this.socket.addEventListener(type, adapter as never);
  }

  removeEventListener<K extends keyof SonioxEventMap>(
    type: K,
    listener: (event: SonioxEventMap[K]) => void,
  ): void {
    const byListener = this.adapters.get(type);
    const adapter = byListener?.get(listener);
    if (!adapter) return;
    this.socket.removeEventListener(type, adapter as never);
    byListener?.delete(listener);
    if (byListener?.size === 0) this.adapters.delete(type);
  }
}

function projectWsEvent<K extends keyof SonioxEventMap>(type: K, event: unknown): SonioxEventMap[K] {
  switch (type) {
    case 'open': return { type: 'open' } as SonioxEventMap[K];
    case 'error': return { type: 'error' } as SonioxEventMap[K];
    case 'message': return {
      type: 'message',
      data: (event as WebSocket.MessageEvent).data,
    } as SonioxEventMap[K];
    case 'close': {
      const close = event as WebSocket.CloseEvent;
      return { type: 'close', code: close.code, wasClean: close.wasClean } as SonioxEventMap[K];
    }
  }
}
