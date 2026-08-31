import {
  PlannerError,
  type AssistantPlan,
  type PlannerLogEvent,
} from './contracts';
import { parseAssistantPlan, parseJson } from './planPolicy';

export const DEFAULT_PLANNER_TIMEOUT_MS = 15_000;
export const MAX_PLANNER_TIMEOUT_MS = 60_000;
export const MAX_PLANNER_REQUEST_BYTES = 64 * 1024;
export const MAX_PLANNER_RESPONSE_BYTES = 128 * 1024;

export interface PlannerRuntimeOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  logger?: (event: PlannerLogEvent) => void;
}

export interface PlannerHttpRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export async function executePlannerRequest(
  request: PlannerHttpRequest,
  extractContent: (envelope: unknown) => string,
  options: PlannerRuntimeOptions,
  operationSignal?: AbortSignal,
): Promise<AssistantPlan> {
  const timeoutMs = validateTimeout(options.timeoutMs);
  const externalSignals = uniqueSignals(options.signal, operationSignal);
  const control = createRequestControl(externalSignals, timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const body = stringifyBoundedRequest(request.body);

  options.logger?.('request-started');
  try {
    if (control.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await withAbort(fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body,
      signal: control.signal,
    }), control.signal);
    if (!response.ok) {
      discardBody(response);
      throw new PlannerError('http-error');
    }
    const responseText = await readBoundedResponse(response, control.signal);
    const content = extractContent(parseJson(responseText));
    const plan = parseAssistantPlan(content);
    options.logger?.('request-succeeded');
    return plan;
  } catch (error) {
    const normalized = normalizePlannerError(
      error,
      control.timedOut(),
      externalSignals,
    );
    options.logger?.(eventForError(normalized.code));
    throw normalized;
  } finally {
    control.dispose();
  }
}

export function validateModel(value: string | undefined, fallback: string, maxLength = 256): string {
  const model = value === undefined || value.trim() === '' ? fallback : value.trim();
  if (
    model.length > maxLength
    || !/^[A-Za-z0-9~][A-Za-z0-9._~:/@+-]*$/u.test(model)
  ) {
    throw new PlannerError('invalid-input');
  }
  return model;
}

export function validateCredential(value: string | undefined, required: boolean): string | undefined {
  if (value === undefined || value.trim() === '') {
    if (required) throw new PlannerError('invalid-input');
    return undefined;
  }
  const credential = value.trim();
  if (credential.length > 4_096 || /[\r\n\u0000]/u.test(credential)) {
    throw new PlannerError('invalid-input');
  }
  return credential;
}

export function validateEndpoint(value: string, allowLoopbackHttp = false): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) {
    throw new PlannerError('invalid-input');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new PlannerError('invalid-input');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new PlannerError('invalid-input');
  }
  if (endpoint.protocol === 'https:') return endpoint.toString();
  if (
    endpoint.protocol === 'http:'
    && allowLoopbackHttp
    && isLoopbackHostname(endpoint.hostname)
  ) {
    return endpoint.toString();
  }
  throw new PlannerError('invalid-input');
}

export function joinEndpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/u, '')}/${path.replace(/^\/+/u, '')}`;
}

function stringifyBoundedRequest(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new PlannerError('invalid-input');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PLANNER_REQUEST_BYTES) {
    throw new PlannerError('invalid-input');
  }
  return serialized;
}

async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PLANNER_RESPONSE_BYTES) {
    discardBody(response);
    throw new PlannerError('invalid-response');
  }

  if (!response.body) {
    const text = await withAbort(response.text(), signal);
    if (Buffer.byteLength(text, 'utf8') > MAX_PLANNER_RESPONSE_BYTES) {
      throw new PlannerError('invalid-response');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_PLANNER_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new PlannerError('invalid-response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8');
}

function discardBody(response: Response): void {
  try {
    if (response.body) void response.body.cancel().catch(() => undefined);
  } catch {
    // Provider response content and cleanup failures remain inside this boundary.
  }
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase();
  if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(hostname);
  if (!match) return false;
  return match.slice(1).every((part) => Number(part) <= 255) && Number(match[1]) === 127;
}

function validateTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PLANNER_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 1 || value > MAX_PLANNER_TIMEOUT_MS) {
    throw new PlannerError('invalid-input');
  }
  return Math.floor(value);
}

function normalizePlannerError(
  error: unknown,
  timedOut: boolean,
  externalSignals: readonly AbortSignal[],
): PlannerError {
  if (timedOut) return new PlannerError('timed-out');
  if (externalSignals.some(({ aborted }) => aborted)) return new PlannerError('aborted');
  if (error instanceof PlannerError) return error;
  return new PlannerError('network-error');
}

function eventForError(code: PlannerError['code']): PlannerLogEvent {
  if (code === 'aborted') return 'request-aborted';
  if (code === 'timed-out') return 'request-timed-out';
  return 'request-failed';
}

function createRequestControl(externalSignals: readonly AbortSignal[], timeoutMs: number): {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
} {
  const controller = new AbortController();
  let timeoutReached = false;
  const abortFromExternal = () => controller.abort();
  if (externalSignals.some(({ aborted }) => aborted)) controller.abort();
  else {
    for (const signal of externalSignals) {
      signal.addEventListener('abort', abortFromExternal, { once: true });
    }
  }
  const timer = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timer);
      for (const signal of externalSignals) {
        signal.removeEventListener('abort', abortFromExternal);
      }
    },
  };
}

function uniqueSignals(...signals: Array<AbortSignal | undefined>): readonly AbortSignal[] {
  return [...new Set(signals.filter((signal): signal is AbortSignal => signal !== undefined))];
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
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
