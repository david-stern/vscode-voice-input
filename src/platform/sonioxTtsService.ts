/**
 * Soniox speech output.
 *
 * Speaking sends the reply text to Soniox, so it is a user-initiated remote operation
 * governed by exactly the same machine/profile-local remote-processing receipt as Soniox
 * transcription: `authority` is that consent port, and a missing or stale receipt refuses
 * the utterance *before* any network call. The API key never leaves the `credentials.use`
 * callback, the text never reaches a command line (audio is piped to the player's stdin),
 * and neither the text nor the audio is ever written to disk or to the log.
 */
import {
  isSonioxTtsVoice,
  sonioxVoiceId,
  sonioxVoiceUri,
} from '../webview/controlCenter/hostVoices';
import {
  SONIOX_PLAYBACK_COMMANDS,
  SONIOX_TTS_AUDIO_FORMAT,
  SONIOX_TTS_ENDPOINT,
  SONIOX_TTS_MODELS_ENDPOINT,
  SONIOX_TTS_SAMPLE_RATE,
  boundedUtterance,
  discardBody,
  sonioxSpeechSpeed,
  synthesisFailure,
  type SonioxPlaybackProcess,
  type SonioxPlaybackStdin,
  type SonioxTtsOutcome,
  type SonioxTtsPlayback,
  type SonioxTtsResponse,
  type SonioxTtsServiceOptions,
  type SonioxTtsSpeakOptions,
} from './sonioxTtsProtocol';
import {
  SONIOX_TTS_MODEL,
  fallbackVoices,
  parseVoiceRoster,
  type SonioxTtsVoice,
} from './sonioxTtsRoster';

export { isSonioxTtsVoice, sonioxVoiceId, sonioxVoiceUri };
export * from './sonioxTtsProtocol';
export {
  SONIOX_TTS_MODEL,
  SONIOX_TTS_FALLBACK_VOICE_IDS,
  fallbackVoices,
  parseVoiceRoster,
  type SonioxTtsVoice,
} from './sonioxTtsRoster';

const SYNTHESIS_TIMEOUT_MS = 15_000;
const VOICE_LIST_TIMEOUT_MS = 5_000;
const DRAIN_TIMEOUT_MS = 5_000;

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

async function closeIterator(chunks: AsyncIterator<Uint8Array>): Promise<void> {
  try { await chunks.return?.(); } catch { /* The stream is already closed. */ }
}

function nextTurn(): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}
