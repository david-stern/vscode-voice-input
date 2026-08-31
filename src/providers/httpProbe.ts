import { type ConnectionProbe, type ConnectionTestCategory } from './connection';

export const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
export const MAX_CONNECTION_TIMEOUT_MS = 30_000;

export interface ProviderResponseBody {
  cancel(): PromiseLike<void> | void;
}

export interface ProviderHttpResponse {
  ok: boolean;
  status: number;
  body?: ProviderResponseBody | null;
}

export type ProviderFetch = (
  input: string,
  init: {
    method: 'GET' | 'POST';
    headers: Readonly<Record<string, string>>;
    signal: AbortSignal;
    body?: string;
  },
) => Promise<ProviderHttpResponse>;

export interface HttpConnectionProbeOptions {
  endpoint: string;
  authorization?: (credential: string) => string;
  headers?: (credential: string | undefined) => Readonly<Record<string, string>>;
  method?: 'GET' | 'POST';
  body?: string;
  credentialRequired?: boolean;
  fetch?: ProviderFetch;
  timeoutMs?: number;
}

/** Provider-boundary adapter. It discards response bodies and maps all failures to fixed categories. */
export class HttpConnectionProbe implements ConnectionProbe {
  private readonly timeoutMs: number;
  private readonly fetch: ProviderFetch;

  constructor(private readonly options: HttpConnectionProbeOptions) {
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as ProviderFetch);
  }

  async probe(credential: string | undefined, callerSignal?: AbortSignal): Promise<ConnectionTestCategory> {
    const control = createRequestControl(callerSignal, this.timeoutMs);
    try {
      if (control.signal.aborted) return control.timedOut() ? 'timed-out' : 'cancelled';
      if ((this.options.credentialRequired ?? true) && !credential) return 'not-configured';
      const headers = this.options.headers?.(credential) ?? (
        credential && this.options.authorization
          ? { Authorization: this.options.authorization(credential) }
          : {}
      );
      const response = await withAbort(
        this.fetch(this.options.endpoint, {
          method: this.options.method ?? 'GET',
          headers: Object.freeze({ ...headers }),
          signal: control.signal,
          ...(this.options.body === undefined ? {} : { body: this.options.body }),
        }),
        control.signal,
      );
      discardBody(response.body);
      return categoryForStatus(response.ok, response.status);
    } catch {
      if (control.timedOut()) return 'timed-out';
      if (callerSignal?.aborted || control.signal.aborted) return 'cancelled';
      return 'unavailable';
    } finally {
      control.dispose();
    }
  }
}

function categoryForStatus(ok: boolean, status: number): ConnectionTestCategory {
  if (ok) return 'connected';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  if (status >= 400 && status < 500) return 'rejected';
  return 'unavailable';
}

function discardBody(body: ProviderResponseBody | null | undefined): void {
  try {
    const cancellation = body?.cancel();
    if (cancellation) void Promise.resolve(cancellation).catch(() => undefined);
  } catch {
    // Response content and cleanup errors stay inside the provider boundary.
  }
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_CONNECTION_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_CONNECTION_TIMEOUT_MS, Math.floor(value)));
}

function createRequestControl(callerSignal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
} {
  const controller = new AbortController();
  let timeoutReached = false;
  const timeout = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (callerSignal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('request-aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('request-aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
