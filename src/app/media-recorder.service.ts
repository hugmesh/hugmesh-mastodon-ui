import { Injectable, OnDestroy, signal } from '@angular/core';

/** What is being captured. Voice messages are audio-only; video messages
 *  capture camera + microphone together. */
export type RecorderKind = 'audio' | 'video';

/** Recorder lifecycle. `requesting` covers the getUserMedia permission prompt
 *  (the user may sit on the browser dialog for a while); `recording` means the
 *  MediaRecorder is live and the elapsed clock is ticking. */
export type RecorderState = 'idle' | 'requesting' | 'recording';

/** Why recording is NOT happening — surfaced fail-soft in the composer instead
 *  of throwing. `unsupported` = no MediaRecorder/getUserMedia in this browser;
 *  `permission-denied` = the user (or a policy) refused mic/camera access;
 *  `failed` = anything else (device unplugged mid-request, encoder error, …). */
export type RecorderError = 'unsupported' | 'permission-denied' | 'failed';

/** Hard cap on a single voice/video message. At 300s the recording auto-stops
 *  and the take is finalised exactly as if the user pressed Stop — never a
 *  silent discard of five minutes of speech. */
export const MAX_RECORDING_SECONDS = 300;

/** UPLOAD SIZE CAP for a finished take, checked by the composer BEFORE the
 *  bytes ever leave the browser. 64 MiB is generous headroom for the worst
 *  legit case this recorder can produce (300s of 720p WebM is ~40–90 MB at
 *  browser-default bitrates; typical homeserver media limits sit at 40–99 MB),
 *  while still refusing a runaway encoder before it wastes minutes of the
 *  user's bandwidth on an upload the server would reject anyway. */
export const MAX_RECORDED_UPLOAD_BYTES = 64 * 1024 * 1024;

/** Preferred container/codec, best first. `audio/webm;codecs=opus` /
 *  `video/webm` are the fediverse-friendly defaults (Chrome/Firefox); the tail
 *  entries let Safari fall back to whatever MediaRecorder.isTypeSupported
 *  accepts rather than failing outright. */
const AUDIO_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
const VIDEO_MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

/** getUserMedia + MediaRecorder wrapper for voice/video MESSAGES in the
 *  composer. NOT root-provided on purpose: every compose box (including the
 *  inline DM reply composers, several of which can be on screen at once) gets
 *  its OWN instance via component `providers`, so one composer's recording
 *  never bleeds state into another. Angular destroys a component-provided
 *  service with its component, and {@link ngOnDestroy} tears down every track —
 *  the mic/camera indicator light can never outlive the composer.
 *
 *  Fail-soft contract (matching the rest of this remote): nothing here throws
 *  at the caller. Feature-absence, permission refusal and encoder failures all
 *  land in the {@link error} signal for the composer to render honestly. */
@Injectable()
export class MediaRecorderService implements OnDestroy {
  readonly state = signal<RecorderState>('idle');
  readonly kind = signal<RecorderKind | null>(null);
  /** Whole seconds since recording started — drives the composer's mm:ss clock
   *  and the {@link MAX_RECORDING_SECONDS} auto-stop. */
  readonly elapsedSeconds = signal(0);
  readonly error = signal<RecorderError | null>(null);
  /** The finished take. Set by {@link stop} — BOTH the manual Stop button and
   *  the 300s auto-cap land here, so the composer only needs to watch this one
   *  signal to offer the preview/attach step. Cleared by clearTake()/cancel(). */
  readonly take = signal<File | null>(null);

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** Re-entrancy guard: the auto-cap tick and a racing Stop click must not both
   *  finalise the same take. */
  private stopping = false;

  /** The live camera/mic stream while recording — the composer binds this to a
   *  muted `<video>.srcObject` for the self-view during video capture. */
  get liveStream(): MediaStream | null {
    return this.stream;
  }

  /** Feature-detect BEFORE showing any record affordance: no MediaRecorder or
   *  no getUserMedia (old browsers, non-secure contexts) → the composer hides
   *  the mic/camera buttons entirely rather than offering a dead control. */
  isSupported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function'
    );
  }

  /** Start recording a voice (audio-only) message. Resolves true once the
   *  recorder is live; false on any refusal (see {@link error}). */
  startAudio(): Promise<boolean> {
    return this.start('audio');
  }

  /** Start recording a video message (camera capped at 720p + microphone). */
  startVideo(): Promise<boolean> {
    return this.start('video');
  }

  private async start(kind: RecorderKind): Promise<boolean> {
    if (this.state() !== 'idle') return false; // one take at a time
    this.error.set(null);
    if (!this.isSupported()) {
      this.error.set('unsupported');
      return false;
    }

    this.state.set('requesting');
    let stream: MediaStream;
    try {
      stream = await this.requestStream(
        kind === 'audio'
          ? { audio: true }
          : {
              audio: true,
              // 720p CAP (max, with ideal to actually ask for it): a five-minute
              // 4K take would blow any sane homeserver upload limit.
              video: { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } },
            },
      );
    } catch (e) {
      this.state.set('idle');
      this.error.set(this.isPermissionDenied(e) ? 'permission-denied' : 'failed');
      return false;
    }

    // The user may have hit Cancel while the permission prompt was open — the
    // late-arriving stream must be released immediately, never left glowing.
    if (this.state() !== 'requesting') {
      this.stopTracks(stream);
      return false;
    }
    this.stream = stream;

    const mimeType = this.pickMimeType(kind);
    try {
      this.recorder = this.createRecorder(stream, mimeType ? { mimeType } : undefined);
      this.chunks = [];
      this.take.set(null);
      this.recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.recorder.start();
    } catch {
      this.teardown();
      this.state.set('idle');
      this.error.set('failed');
      return false;
    }

    this.kind.set(kind);
    this.elapsedSeconds.set(0);
    this.state.set('recording');
    this.ticker = setInterval(() => {
      const next = this.elapsedSeconds() + 1;
      this.elapsedSeconds.set(next);
      // HARD CAP: finalise (not discard) the take at 300s, exactly like Stop.
      if (next >= MAX_RECORDING_SECONDS && !this.stopping) void this.stop();
    }, 1000);
    return true;
  }

  /** Stop recording and finalise the take: resolves to a File named
   *  `voice-message-…` / `video-message-…` (extension follows the container the
   *  recorder actually produced, webm by default), also published on the
   *  {@link take} signal. Every track is stopped in all paths. Resolves null if
   *  nothing was recording or the recorder failed to finalise. */
  async stop(): Promise<File | null> {
    const recorder = this.recorder;
    if (!recorder || this.stopping || this.state() !== 'recording') return null;
    this.stopping = true;
    const kind = this.kind() ?? 'audio';

    const file = await new Promise<File | null>((resolve) => {
      recorder.onstop = () => {
        // Container type from the recorder itself (parameters stripped); the
        // homeserver transcodes anyway, this only needs to be honest.
        const mime = (recorder.mimeType || (kind === 'audio' ? 'audio/webm' : 'video/webm')).split(';')[0].trim();
        const blob = new Blob(this.chunks, { type: mime });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const prefix = kind === 'audio' ? 'voice-message' : 'video-message';
        resolve(new File([blob], `${prefix}-${stamp}.${this.extensionFor(kind, mime)}`, { type: mime }));
      };
      try {
        recorder.stop(); // fires the final dataavailable, then onstop
      } catch {
        resolve(null); // recorder already dead — fail-soft, teardown still runs
      }
    });

    this.teardown();
    this.stopping = false;
    this.state.set('idle');
    if (file && file.size > 0) this.take.set(file);
    else this.error.set('failed');
    return file && file.size > 0 ? file : null;
  }

  /** Abandon the current recording (or a pending permission request): stops the
   *  recorder WITHOUT finalising, stops every track, discards all chunks and
   *  any finished take. Safe to call in any state. */
  cancel(): void {
    const recorder = this.recorder;
    if (recorder) {
      // Detach handlers FIRST so the implicit final dataavailable/onstop from
      // recorder.stop() can never resurrect discarded chunks as a take.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* already stopped — nothing to do */
      }
    }
    this.teardown();
    this.stopping = false;
    this.state.set('idle'); // a cancel during 'requesting' parks the late stream (see start)
    this.kind.set(null);
    this.take.set(null);
    this.error.set(null);
  }

  /** Consume the published take (the composer adopts it into its own preview
   *  state, so the service is free for the next recording). */
  clearTake(): void {
    this.take.set(null);
  }

  /** Component-provided: Angular destroys this service with its compose box —
   *  release the mic/camera unconditionally. */
  ngOnDestroy(): void {
    this.cancel();
  }

  // ── test seams (spec stubs these; production uses the platform APIs) ─────

  /** Wrapped so the spec can stub getUserMedia (the real one would hit the
   *  browser permission UI / need fake-device flags in CI). */
  protected requestStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  /** Wrapped so the spec can substitute a scriptable fake for the platform
   *  MediaRecorder constructor. */
  protected createRecorder(stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder {
    return options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** First candidate the browser claims to support; null lets the constructor
   *  pick its own default (still recorded, honest extension via mimeType). */
  private pickMimeType(kind: RecorderKind): string | null {
    const candidates = kind === 'audio' ? AUDIO_MIME_CANDIDATES : VIDEO_MIME_CANDIDATES;
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
    return (
      candidates.find((t) => {
        try {
          return MediaRecorder.isTypeSupported(t);
        } catch {
          return false;
        }
      }) ?? null
    );
  }

  private extensionFor(kind: RecorderKind, mime: string): string {
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('mp4')) return kind === 'audio' ? 'm4a' : 'mp4';
    return 'webm';
  }

  private isPermissionDenied(e: unknown): boolean {
    return (
      e instanceof DOMException &&
      (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || e.name === 'SecurityError')
    );
  }

  private stopTracks(stream: MediaStream | null): void {
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* a dead track's stop() throwing must never block teardown */
    }
  }

  /** Release EVERYTHING except the published take/error signals: clock, every
   *  track (mic light off), recorder handle, buffered chunks. */
  private teardown(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.stopTracks(this.stream);
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}
