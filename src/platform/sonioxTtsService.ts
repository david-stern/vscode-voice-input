import {
  MAX_SONIOX_TTS_VOICES,
  isSonioxTtsVoice,
  sonioxVoiceId,
  sonioxVoiceUri,
} from '../webview/controlCenter/hostVoices';

export { isSonioxTtsVoice, sonioxVoiceId, sonioxVoiceUri };

/**
 * Soniox speech output.
 *
 * Speaking sends the reply text to Soniox, so it is governed by exactly the same
 * machine/profile-local remote-processing receipt as Soniox transcription: `authority`
 * is the consent port, and a missing or stale receipt refuses the utterance *before*
 * any network call. The API key never leaves the `credentials.use` callback, the text
 * never reaches a command line (audio is piped to the player's stdin), and neither the
 * text nor the audio is ever written to disk or to the log.
 */
export const SONIOX_TTS_ENDPOINT = 'https://tts-rt.soniox.com/tts';
export const SONIOX_TTS_MODELS_ENDPOINT = 'https://api.soniox.com/v1/tts-models';
export const SONIOX_TTS_MODEL = 'tts-rt-v2';
export const SONIOX_TTS_SAMPLE_RATE = 24_000;
export const SONIOX_TTS_AUDIO_FORMAT = 'wav';

/** The provider rejects longer requests, so the host truncates before it asks. */
export const MAX_SONIOX_TTS_TEXT_LENGTH = 5_000;

/** Our 0.5..2 rate maps onto the provider's supported 0.7..1.3 speed window. */
export const MIN_SONIOX_TTS_SPEED = 0.7;
export const MAX_SONIOX_TTS_SPEED = 1.3;

const SYNTHESIS_TIMEOUT_MS = 15_000;
const VOICE_LIST_TIMEOUT_MS = 5_000;
const DRAIN_TIMEOUT_MS = 5_000;

/**
 * Playback is stdin-only so no spoken text can ever appear in argv or in a temp file.
 * `paplay` reads stdin when it is given no file operand; `aplay -q -` is the fallback
 * for hosts without PulseAudio/PipeWire tooling.
 */
export const SONIOX_PLAYBACK_COMMANDS: readonly Readonly<{
  command: string;
  args: readonly string[];
}>[] = Object.freeze([
  Object.freeze({ command: 'paplay', args: Object.freeze([] as string[]) }),
  Object.freeze({ command: 'aplay', args: Object.freeze(['-q', '-']) }),
]);

/** Used only when the roster request fails; every listed voice speaks every language. */
export const SONIOX_TTS_FALLBACK_VOICE_IDS: readonly string[] = Object.freeze([
  'Adrian', 'Maya', 'Daniel', 'Grace', 'Oliver',
]);

export type SonioxTtsOutcome = 'completed' | 'error' | 'cancelled';

export interface SonioxTtsVoice {
  readonly id: string;
  readonly name: string;
}

export interface SonioxTtsPlayback {
  readonly done: Promise<SonioxTtsOutcome>;
  cancel(): void;
}

export interface SonioxTtsSpeakOptions {
  language: 'he' | 'en';
  rate: number;
  voice: string;
}

/** Minimal structural response so tests never open a socket. */
export interface SonioxTtsResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  body?: AsyncIterable<Uint8Array> | null;
}

export type SonioxTtsFetch = (
  input: string,
  init: {
    method: 'GET' | 'POST';
    headers: Readonly<Record<string, string>>;
    signal: AbortSignal;
    body?: string;
  },
) => Promise<SonioxTtsResponse>;

export interface SonioxPlaybackStdin {
  write(chunk: Uint8Array): boolean;
  end(): void;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  once?(event: 'drain', listener: () => void): unknown;
}

/** Minimal structural view of a spawned player, so tests never start a real process. */
export interface SonioxPlaybackProcess {
  readonly stdin: SonioxPlaybackStdin | null;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SonioxPlaybackSpawn = (
  command: string,
  args: readonly string[],
) => SonioxPlaybackProcess;

/** The Soniox remote-processing consent port; identical to the transcription gate. */
export interface SonioxTtsAuthority {
  capture(): PromiseLike<Readonly<object> | undefined> | Readonly<object> | undefined;
}

export interface SonioxTtsCredentials {
  use<T>(provider: 'soniox', operation: (credential: string) => Promise<T>): Promise<T | undefined>;
}

export interface SonioxTtsServiceOptions {
  fetch: SonioxTtsFetch;
  spawn: SonioxPlaybackSpawn;
  credentials: SonioxTtsCredentials;
  authority: SonioxTtsAuthority;
  /** Content-free: spoken text, audio bytes, and credentials are never logged. */
  log(message: string): void;
  synthesisTimeoutMs?: number;
  voiceListTimeoutMs?: number;
}

interface Session {
  readonly controller: AbortController;
  child?: SonioxPlaybackProcess;
  cancelled: boolean;
}

interface Playback {
  readonly child: SonioxPlaybackProcess;
  readonly exited: Promise<SonioxTtsOutcome>;
  readonly failed: boolean;
}

/** Binds a player's outcome at spawn time, so no exit or error event can be missed. */
function observePlayback(child: SonioxPlaybackProcess): Playback {
  const state = { failed: false };
  let settle: (outcome: SonioxTtsOutcome) => void = () => {};
  const exited = new Promise<SonioxTtsOutcome>((resolve) => { settle = resolve; });
  child.on('error', () => { state.failed = true; settle('error'); });
  child.on('exit', (code) => settle(code === 0 ? 'completed' : 'error'));
  return {
    child,
    exited,
    get failed() { return state.failed; },
  };
}

/** Host-side Soniox speech output. One utterance at a time; every failure is bounded. */
export class SonioxTtsService {
  private active: Session | undefined;
  private voices: readonly SonioxTtsVoice[] | undefined;
  private voicesInFlight: Promise<readonly SonioxTtsVoice[]> | undefined;
  private disposed = false;

  constructor(private readonly options: SonioxTtsServiceOptions) {}

  /** Starts one utterance, cancelling any previous one. The promise never rejects. */
  synthesizeAndPlay(text: string, options: SonioxTtsSpeakOptions): SonioxTtsPlayback {
    const session: Session = { controller: new AbortController(), cancelled: false };
    this.cancel();
    this.active = session;
    const done = this.run(boundedUtterance(text), options, session)
      .catch(() => 'error' as const)
      .then((outcome) => {
        if (this.active === session) this.active = undefined;
        return session.cancelled ? 'cancelled' as const : outcome;
      });
    return { done, cancel: () => this.cancelSession(session) };
  }

  /** Cancels the current utterance; safe to call when nothing is speaking. */
  cancel(): void {
    const session = this.active;
    this.active = undefined;
    if (session) this.cancelSession(session);
  }

  /**
   * The session voice roster. Refused without a consent receipt, cached once it resolves,
   * and answered from a packaged roster when the request itself fails.
   */
  listVoices(): Promise<readonly SonioxTtsVoice[]> {
    if (this.voices) return Promise.resolve(this.voices);
    if (!this.voicesInFlight) {
      this.voicesInFlight = this.loadVoices().then(
        (voices) => { this.voicesInFlight = undefined; return voices; },
        () => { this.voicesInFlight = undefined; return []; },
      );
    }
    return this.voicesInFlight;
  }

  /** Drops the cached roster so a revoked or rotated authority cannot keep it alive. */
  invalidateVoices(): void {
    this.voices = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.invalidateVoices();
  }

  private async run(
    text: string,
    options: SonioxTtsSpeakOptions,
    session: Session,
  ): Promise<SonioxTtsOutcome> {
    const voice = sonioxVoiceId(sonioxVoiceUri(options.voice));
    if (this.disposed || !text || !voice) return 'error';
    // Fail closed before the network: no receipt means no text leaves this machine.
    if (!await this.captureAuthority()) {
      this.options.log('soniox speech refused: remote processing consent is unavailable');
      return 'error';
    }
    if (session.cancelled) return 'cancelled';
    const outcome = await this.options.credentials.use(
      'soniox',
      (credential) => this.speakWithCredential(credential, text, { ...options, voice }, session),
    );
    if (outcome === undefined) {
      this.options.log('soniox speech refused: no credential is configured');
      return 'error';
    }
    return outcome;
  }

  private async speakWithCredential(
    credential: string,
    text: string,
    options: SonioxTtsSpeakOptions,
    session: Session,
  ): Promise<SonioxTtsOutcome> {
    const timer = setTimeout(
      () => session.controller.abort(),
      this.options.synthesisTimeoutMs ?? SYNTHESIS_TIMEOUT_MS,
    );
    let response: SonioxTtsResponse;
    try {
      response = await this.options.fetch(SONIOX_TTS_ENDPOINT, {
        method: 'POST',
        headers: Object.freeze({
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json',
        }),
        signal: session.controller.signal,
        body: JSON.stringify({
          model: SONIOX_TTS_MODEL,
          language: options.language === 'he' ? 'he' : 'en',
          voice: options.voice,
          audio_format: SONIOX_TTS_AUDIO_FORMAT,
          sample_rate: SONIOX_TTS_SAMPLE_RATE,
          speed: sonioxSpeechSpeed(options.rate),
          text,
        }),
      });
    } catch {
      // Provider bodies and raw network errors stay at this boundary.
      this.options.log(session.cancelled
        ? 'soniox speech cancelled before playback'
        : 'soniox speech request failed: unavailable');
      return session.cancelled ? 'cancelled' : 'error';
    } finally {
      // The response headers are in: the rest is bounded by the player's own lifetime.
      clearTimeout(timer);
    }
    if (!response.ok) {
      this.options.log(`soniox speech rejected: ${synthesisFailure(response.status)}`);
      await discardBody(response);
      return 'error';
    }
    return this.play(response.body, session);
  }

  private async play(
    body: AsyncIterable<Uint8Array> | null | undefined,
    session: Session,
  ): Promise<SonioxTtsOutcome> {
    if (!body) {
      this.options.log('soniox speech returned no audio');
      return 'error';
    }
    const chunks = body[Symbol.asyncIterator]();
    let chunk: IteratorResult<Uint8Array>;
    try {
      // Nothing is spawned until real audio arrives, so a refusal never touches audio.
      chunk = await chunks.next();
    } catch {
      this.options.log('soniox speech audio stream failed');
      return session.cancelled ? 'cancelled' : 'error';
    }
    if (chunk.done) {
      this.options.log('soniox speech returned no audio');
      return session.cancelled ? 'cancelled' : 'error';
    }
    const playback = await this.startPlayback(session);
    const stdin = playback?.child.stdin;
    if (!playback || !stdin) {
      await closeIterator(chunks);
      return session.cancelled ? 'cancelled' : 'error';
    }
    // Writes race the child's own lifetime; the exit outcome stays authoritative.
    stdin.on('error', () => {});
    const written = this.writeAudio(stdin, chunk.value, chunks, session);
    await Promise.race([written, playback.exited]);
    return playback.exited;
  }

  private async writeAudio(
    stdin: SonioxPlaybackStdin,
    first: Uint8Array,
    chunks: AsyncIterator<Uint8Array>,
    session: Session,
  ): Promise<void> {
    let chunk: IteratorResult<Uint8Array> = { done: false, value: first };
    try {
      while (!chunk.done) {
        if (session.cancelled || this.disposed) break;
        await this.writeChunk(stdin, chunk.value);
        chunk = await chunks.next();
      }
    } catch {
      // A truncated stream still ends stdin, so the player exits and reports the outcome.
    } finally {
      await closeIterator(chunks);
      try { stdin.end(); } catch { /* The player already exited. */ }
    }
  }

  /** Honours backpressure so a long utterance never buffers unboundedly in the host. */
  private writeChunk(stdin: SonioxPlaybackStdin, chunk: Uint8Array): Promise<void> | void {
    if (stdin.write(chunk) || !stdin.once) return;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DRAIN_TIMEOUT_MS);
      timer.unref?.();
      stdin.once?.('drain', () => { clearTimeout(timer); resolve(); });
    });
  }

  private async startPlayback(session: Session): Promise<Playback | undefined> {
    for (const { command, args } of SONIOX_PLAYBACK_COMMANDS) {
      if (session.cancelled || this.disposed) return undefined;
      let child: SonioxPlaybackProcess | undefined;
      try {
        child = this.options.spawn(command, args);
      } catch {
        child = undefined;
      }
      if (!child) {
        this.options.log('soniox speech could not start an audio player');
        continue;
      }
      // The lifetime is observed from the first instant, so a player that dies during the
      // check below can never leave this promise unresolved.
      const playback = observePlayback(child);
      // A missing player reports ENOENT asynchronously, so one turn of the loop decides
      // whether this command works before any audio is handed to it.
      await nextTurn();
      if (!playback.failed && child.stdin && !session.cancelled && !this.disposed) {
        session.child = child;
        return playback;
      }
      this.killChild(child);
      if (session.cancelled || this.disposed) return undefined;
      this.options.log('soniox speech audio player is unavailable');
    }
    return undefined;
  }

  private async loadVoices(): Promise<readonly SonioxTtsVoice[]> {
    if (this.disposed) return [];
    if (!await this.captureAuthority()) {
      this.options.log('soniox voice list refused: remote processing consent is unavailable');
      return [];
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.voiceListTimeoutMs ?? VOICE_LIST_TIMEOUT_MS,
    );
    let fetched: readonly SonioxTtsVoice[] | undefined;
    let refused = false;
    try {
      fetched = await this.options.credentials.use('soniox', async (credential) => {
        const response = await this.options.fetch(SONIOX_TTS_MODELS_ENDPOINT, {
          method: 'GET',
          headers: Object.freeze({ Authorization: `Bearer ${credential}` }),
          signal: controller.signal,
        });
        if (!response.ok) {
          await discardBody(response);
          throw new Error('voice roster is unavailable');
        }
        return parseVoiceRoster(await response.json());
      });
      refused = fetched === undefined;
    } catch {
      fetched = undefined;
    } finally {
      clearTimeout(timer);
    }
    if (this.disposed) return [];
    if (fetched && fetched.length > 0) {
      this.voices = fetched;
      this.options.log(`soniox voice list loaded: ${fetched.length}`);
      return this.voices;
    }
    if (refused) {
      this.options.log('soniox voice list refused: no credential is configured');
      return [];
    }
    this.voices = fallbackVoices();
    this.options.log('soniox voice list unavailable: using the packaged roster');
    return this.voices;
  }

  private async captureAuthority(): Promise<boolean> {
    try {
      return Boolean(await this.options.authority.capture());
    } catch {
      return false;
    }
  }

  private cancelSession(session: Session): void {
    if (session.cancelled) return;
    session.cancelled = true;
    if (this.active === session) this.active = undefined;
    try { session.controller.abort(); } catch { /* Cancellation is best effort. */ }
    const child = session.child;
    session.child = undefined;
    if (child) this.killChild(child);
  }

  private killChild(child: SonioxPlaybackProcess): void {
    try { child.kill('SIGTERM'); } catch {
      this.options.log('soniox speech could not stop an audio player');
    }
  }
}

/** Truncates on a word boundary so a long reply is never cut mid-word. */
export function boundedUtterance(text: unknown): string {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (normalized.length <= MAX_SONIOX_TTS_TEXT_LENGTH) return normalized;
  const capped = normalized.slice(0, MAX_SONIOX_TTS_TEXT_LENGTH);
  const boundary = capped.search(/\s\S*$/u);
  return (boundary > 0 ? capped.slice(0, boundary) : capped).trim();
}

/** Maps the extension's 0.5..2 speech rate onto the provider's 0.7..1.3 speed window. */
export function sonioxSpeechSpeed(rate: unknown): number {
  const value = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1;
  const clamped = Math.min(MAX_SONIOX_TTS_SPEED, Math.max(MIN_SONIOX_TTS_SPEED, value));
  return Math.round(clamped * 100) / 100;
}

/** Fixed categories only: provider error bodies never reach the log. */
export function synthesisFailure(status: unknown): string {
  if (status === 401 || status === 403) return 'unauthenticated';
  if (status === 402) return 'budget-exhausted';
  if (status === 413) return 'utterance-too-long';
  if (status === 429) return 'rate-limited';
  return 'unavailable';
}

export function fallbackVoices(): readonly SonioxTtsVoice[] {
  return Object.freeze(SONIOX_TTS_FALLBACK_VOICE_IDS.map(
    (id) => Object.freeze({ id, name: id }),
  ));
}

/** Accepts only well-formed ids from the provider roster, bounded and de-duplicated. */
export function parseVoiceRoster(body: unknown): readonly SonioxTtsVoice[] {
  const models = readArray(readRecord(body)?.models);
  const model = models.find((entry) => readRecord(entry)?.id === SONIOX_TTS_MODEL) ?? models[0];
  const voices: SonioxTtsVoice[] = [];
  const seen = new Set<string>();
  for (const entry of readArray(readRecord(model)?.voices)) {
    const id = readRecord(entry)?.id;
    if (typeof id !== 'string' || !sonioxVoiceUri(id) || seen.has(id)) continue;
    seen.add(id);
    voices.push(Object.freeze({ id, name: id }));
    if (voices.length >= MAX_SONIOX_TTS_VOICES) break;
  }
  return Object.freeze(voices);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function closeIterator(chunks: AsyncIterator<Uint8Array>): Promise<void> {
  try { await chunks.return?.(); } catch { /* The stream is already closed. */ }
}

function nextTurn(): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

/** Consumes a rejected body so the connection closes; the body never reaches the log. */
async function discardBody(response: SonioxTtsResponse): Promise<void> {
  try { await response.json(); } catch { /* The body is unreadable and stays unread. */ }
}
