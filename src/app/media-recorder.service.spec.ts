import {
  MAX_RECORDING_SECONDS,
  MediaRecorderService,
} from './media-recorder.service';

/** Scriptable stand-in for the platform MediaRecorder: `stop()` fires the
 *  final dataavailable + onstop synchronously, like Chrome does for a
 *  no-timeslice recording that ends. */
class FakeMediaRecorder {
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  startCalls = 0;
  stopCalls = 0;

  start(): void {
    this.startCalls++;
    this.state = 'recording';
  }

  stop(): void {
    this.stopCalls++;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: this.mimeType.split(';')[0] }) });
    this.onstop?.();
  }
}

interface FakeTrack {
  stop: jasmine.Spy;
  readyState: string;
}

function fakeStream(trackCount = 1): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks: FakeTrack[] = Array.from({ length: trackCount }, (_, i) => ({
    stop: jasmine.createSpy(`track${i}.stop`),
    readyState: 'live',
  }));
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, tracks };
}

/** Flush the microtask chain inside stop() (the awaited onstop promise) without
 *  relying on setTimeout, which jasmine.clock() fakes in the cap tests. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('MediaRecorderService', () => {
  let service: MediaRecorderService;
  let fake: FakeMediaRecorder;
  let tracks: FakeTrack[];
  let requestStream: jasmine.Spy;
  let createRecorder: jasmine.Spy;

  beforeEach(() => {
    service = new MediaRecorderService();
    fake = new FakeMediaRecorder();
    const made = fakeStream(2); // e.g. mic + camera
    tracks = made.tracks;
    // Stub the platform seams: the real getUserMedia would hit the browser
    // permission UI in Karma, and MediaRecorder cannot be constructor-spied.
    requestStream = spyOn<any>(service, 'requestStream').and.resolveTo(made.stream);
    createRecorder = spyOn<any>(service, 'createRecorder').and.returnValue(fake as unknown as MediaRecorder);
  });

  afterEach(() => service.ngOnDestroy());

  it('reports supported in a browser with MediaRecorder + getUserMedia (Chrome CI)', () => {
    expect(service.isSupported()).toBeTrue();
  });

  it('starts idle with no take, no error, zero elapsed', () => {
    expect(service.state()).toBe('idle');
    expect(service.take()).toBeNull();
    expect(service.error()).toBeNull();
    expect(service.elapsedSeconds()).toBe(0);
  });

  // ── state transitions ────────────────────────────────────────────────────

  it('startAudio() requests an audio-only stream and transitions idle → recording', async () => {
    const ok = await service.startAudio();
    expect(ok).toBeTrue();
    expect(service.state()).toBe('recording');
    expect(service.kind()).toBe('audio');
    expect(fake.startCalls).toBe(1);
    const [constraints] = requestStream.calls.mostRecent().args;
    expect(constraints).toEqual({ audio: true });
  });

  it('startVideo() asks for camera capped at 720p PLUS audio', async () => {
    await service.startVideo();
    expect(service.kind()).toBe('video');
    const [constraints] = requestStream.calls.mostRecent().args as [MediaStreamConstraints];
    expect(constraints.audio).toBeTrue();
    const video = constraints.video as MediaTrackConstraints;
    expect(video.width).toEqual({ ideal: 1280, max: 1280 });
    expect(video.height).toEqual({ ideal: 720, max: 720 });
  });

  it('prefers an audio/webm opus mime when the browser supports it', async () => {
    await service.startAudio();
    const [, options] = createRecorder.calls.mostRecent().args as [MediaStream, MediaRecorderOptions?];
    // Chrome CI supports audio/webm;codecs=opus — the first candidate.
    expect(options?.mimeType).toMatch(/^audio\/webm/);
  });

  it('refuses a second start while one is already recording', async () => {
    await service.startAudio();
    const again = await service.startVideo();
    expect(again).toBeFalse();
    expect(requestStream.calls.count()).toBe(1);
    expect(service.kind()).toBe('audio');
  });

  it('exposes the live stream for the video self-view while recording', async () => {
    expect(service.liveStream).toBeNull();
    await service.startVideo();
    expect(service.liveStream).not.toBeNull();
  });

  // ── stop: File naming + take signal + teardown ───────────────────────────

  it('stop() resolves a voice-message-….webm File, publishes it on take, and stops every track', async () => {
    await service.startAudio();
    const file = await service.stop();
    expect(file).withContext('stop must resolve the finalised File').not.toBeNull();
    expect(file!.name).toMatch(/^voice-message-.+\.webm$/);
    expect(file!.type).toBe('audio/webm');
    expect(file!.size).toBeGreaterThan(0);
    expect(service.take()).toBe(file);
    expect(service.state()).toBe('idle');
    expect(service.liveStream).withContext('stream must be released').toBeNull();
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
  });

  it('stop() names a video take video-message-….webm', async () => {
    fake.mimeType = 'video/webm;codecs=vp9,opus';
    await service.startVideo();
    const file = await service.stop();
    expect(file!.name).toMatch(/^video-message-.+\.webm$/);
    expect(file!.type).toBe('video/webm');
  });

  it('stop() is a null no-op when nothing is recording (idle / double-stop)', async () => {
    expect(await service.stop()).toBeNull();
    await service.startAudio();
    await service.stop();
    expect(await service.stop()).withContext('second stop must not re-finalise').toBeNull();
    expect(fake.stopCalls).toBe(1);
  });

  it('clearTake() consumes the published take without touching state', async () => {
    await service.startAudio();
    await service.stop();
    expect(service.take()).not.toBeNull();
    service.clearTake();
    expect(service.take()).toBeNull();
    expect(service.state()).toBe('idle');
  });

  // ── cancel: discard everything, stop every track ─────────────────────────

  it('cancel() while recording stops the recorder + every track and discards the chunks (no take)', async () => {
    await service.startAudio();
    service.cancel();
    expect(service.state()).toBe('idle');
    expect(service.take()).withContext('a cancelled recording must never surface a take').toBeNull();
    expect(service.kind()).toBeNull();
    expect(fake.stopCalls).toBe(1);
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
    expect(service.liveStream).toBeNull();
  });

  it('cancel() during the permission prompt releases the late-arriving stream', async () => {
    let release!: (s: MediaStream) => void;
    requestStream.and.returnValue(new Promise<MediaStream>((r) => (release = r)));
    const started = service.startAudio();
    expect(service.state()).toBe('requesting');
    service.cancel(); // user gives up while the browser dialog is open
    expect(service.state()).toBe('idle');
    const { stream, tracks: lateTracks } = fakeStream();
    release(stream); // permission granted AFTER the cancel
    expect(await started).toBeFalse();
    for (const t of lateTracks) {
      expect(t.stop).withContext('late stream must be released, mic light off').toHaveBeenCalled();
    }
    expect(service.liveStream).toBeNull();
  });

  it('ngOnDestroy() tears down an in-flight recording (component destroyed mid-take)', async () => {
    await service.startAudio();
    service.ngOnDestroy();
    expect(service.state()).toBe('idle');
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
  });

  // ── refusal states (fail-soft, never a throw) ────────────────────────────

  it('surfaces unsupported when the platform APIs are missing', async () => {
    spyOn(service, 'isSupported').and.returnValue(false);
    const ok = await service.startAudio();
    expect(ok).toBeFalse();
    expect(service.state()).toBe('idle');
    expect(service.error()).toBe('unsupported');
  });

  it('surfaces permission-denied when getUserMedia rejects with NotAllowedError', async () => {
    requestStream.and.rejectWith(new DOMException('Permission denied', 'NotAllowedError'));
    const ok = await service.startAudio();
    expect(ok).toBeFalse();
    expect(service.state()).toBe('idle');
    expect(service.error()).toBe('permission-denied');
    expect(service.liveStream).toBeNull();
  });

  it('surfaces failed (not permission-denied) for any other getUserMedia refusal', async () => {
    requestStream.and.rejectWith(new DOMException('Requested device not found', 'NotFoundError'));
    await service.startAudio();
    expect(service.error()).toBe('failed');
    expect(service.state()).toBe('idle');
  });

  it('tears the stream down when the MediaRecorder constructor itself fails', async () => {
    createRecorder.and.throwError(new Error('no encoder'));
    const ok = await service.startAudio();
    expect(ok).toBeFalse();
    expect(service.error()).toBe('failed');
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
  });

  it('a new start clears the previous error', async () => {
    requestStream.and.rejectWith(new DOMException('nope', 'NotAllowedError'));
    await service.startAudio();
    expect(service.error()).toBe('permission-denied');
    const { stream } = fakeStream();
    requestStream.and.resolveTo(stream);
    await service.startAudio();
    expect(service.error()).toBeNull();
    expect(service.state()).toBe('recording');
  });

  // ── elapsed clock + 300s hard cap ────────────────────────────────────────

  describe('with fake timers', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('ticks elapsedSeconds once per second while recording', async () => {
      await service.startAudio();
      expect(service.elapsedSeconds()).toBe(0);
      jasmine.clock().tick(65_000);
      expect(service.elapsedSeconds()).toBe(65);
    });

    it('auto-stops at the 300s hard cap: take published, every track stopped', async () => {
      await service.startAudio();
      jasmine.clock().tick(MAX_RECORDING_SECONDS * 1000);
      await flushMicrotasks(); // let the internal stop() finalise
      expect(service.state()).toBe('idle');
      expect(service.elapsedSeconds()).toBe(MAX_RECORDING_SECONDS);
      expect(service.take()).withContext('the capped take is finalised, never discarded').not.toBeNull();
      expect(service.take()!.name).toMatch(/^voice-message-.+\.webm$/);
      expect(fake.stopCalls).toBe(1);
      for (const t of tracks) expect(t.stop).toHaveBeenCalled();
    });

    it('the clock stops ticking after cancel (interval cleared)', async () => {
      await service.startAudio();
      jasmine.clock().tick(3_000);
      expect(service.elapsedSeconds()).toBe(3);
      service.cancel();
      jasmine.clock().tick(10_000);
      expect(service.elapsedSeconds()).toBe(3);
    });
  });
});
