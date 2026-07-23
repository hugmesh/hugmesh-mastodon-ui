import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComposeBoxComponent, POISON_DEFAULT_KEY } from './compose-box.component';
import { MastodonService, ProtectedMediaAttachment, Status } from './mastodon.service';
import {
  MAX_RECORDED_UPLOAD_BYTES,
  MediaRecorderService,
  RecorderError,
  RecorderKind,
  RecorderState,
} from './media-recorder.service';
import { HugSession } from './session.service';

/** Hand-rolled MediaRecorderService mock: REAL writable signals (the component
 *  reads them in its template/ngDoCheck) + spies for the imperative surface.
 *  clearTake really clears, like the service, so the take is adopted once. */
interface RecorderMock {
  state: WritableSignal<RecorderState>;
  kind: WritableSignal<RecorderKind | null>;
  elapsedSeconds: WritableSignal<number>;
  error: WritableSignal<RecorderError | null>;
  take: WritableSignal<File | null>;
  liveStream: MediaStream | null;
  isSupported: jasmine.Spy;
  startAudio: jasmine.Spy;
  startVideo: jasmine.Spy;
  stop: jasmine.Spy;
  cancel: jasmine.Spy;
  clearTake: jasmine.Spy;
}

function makeRecorderMock(): RecorderMock {
  const mock: RecorderMock = {
    state: signal<RecorderState>('idle'),
    kind: signal<RecorderKind | null>(null),
    elapsedSeconds: signal(0),
    error: signal<RecorderError | null>(null),
    take: signal<File | null>(null),
    liveStream: null,
    isSupported: jasmine.createSpy('isSupported').and.returnValue(true),
    startAudio: jasmine.createSpy('startAudio').and.resolveTo(true),
    startVideo: jasmine.createSpy('startVideo').and.resolveTo(true),
    stop: jasmine.createSpy('stop').and.resolveTo(null),
    cancel: jasmine.createSpy('cancel'),
    clearTake: jasmine.createSpy('clearTake'),
  };
  mock.clearTake.and.callFake(() => mock.take.set(null));
  return mock;
}

function makeStatus(over: Partial<Status> = {}): Status {
  return { id: 'posted', reblog: null, ...over } as Status;
}

/** Write a session into localStorage BEFORE the component is created so the
 *  root SessionService hydrates it. `roles` carries the domain-lock marker in
 *  its on-the-wire (lowercased) form for the locked cases. */
function seedSession(roles: string[]): void {
  const session: HugSession = {
    id: 'google:alice@gmail.com',
    label: 'alice@gmail.com',
    provider: 'google',
    roles,
    registrationComplete: true,
  };
  localStorage.setItem('hug.session', JSON.stringify(session));
}

describe('ComposeBoxComponent', () => {
  let fixture: ComponentFixture<ComposeBoxComponent>;
  let component: ComposeBoxComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;
  let recorder: RecorderMock;

  beforeEach(async () => {
    localStorage.clear();
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'postStatus',
      'uploadMedia',
      'uploadMediaProtected',
      'updateMedia',
      'getMedia',
      'cloakCapability',
      'cloakStatus',
    ]);
    // The composer queries capability on construction; default to the heavy
    // tier present so the shield renders an available 'Glaze' state.
    mastodon.cloakCapability.and.resolveTo({ available: true, backend: 'cuda', defaultMode: 'glaze' });
    recorder = makeRecorderMock();

    await TestBed.configureTestingModule({
      imports: [ComposeBoxComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }],
    })
      // The recorder is COMPONENT-provided (one per composer), so a plain
      // module provider would be shadowed — override the provider itself.
      // NOTE: deliberately overrideProvider, NOT overrideComponent(set:
      // providers): recompiling the component def via overrideComponent makes
      // fixtures created mid-test (the domain-lock describe below) trip
      // NG0100 checkNoChanges errors on their two-way bindings.
      .overrideProvider(MediaRecorderService, { useValue: recorder })
      .compileComponents();

    fixture = TestBed.createComponent(ComposeBoxComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('labels the compose textarea with a <label for> pointing at its id (WCAG 3.3.2)', () => {
    const textarea = el().querySelector<HTMLTextAreaElement>('[data-testid="mastodon-input"]')!;
    expect(textarea.id).toBeTruthy();
    const label = el().querySelector(`label[for="${textarea.id}"]`);
    expect(label).withContext('textarea must have an associated label').not.toBeNull();
  });

  it('keeps the attach-media file input keyboard-reachable (in the tab order, not hidden)', () => {
    // WCAG 2.1.1: the only attach control is the native file input. It must stay
    // in the tab order so a keyboard user can Tab to it and open the picker with
    // Enter/Space. A `hidden` input would be unreachable (and a <label> is not
    // focusable on its own).
    const input = el().querySelector<HTMLInputElement>('[data-testid="compose-media-input"]')!;
    expect(input).withContext('attach-media input must exist').not.toBeNull();
    expect(input.type).toBe('file');
    expect(input.hasAttribute('hidden')).withContext('must not be `hidden` (removes it from the tab order)').toBeFalse();
    expect(input.tabIndex).withContext('must remain keyboard-focusable').toBeGreaterThanOrEqual(0);
    // Visually hidden via the shared `.sr` utility, yet still operable.
    expect(input.classList.contains('sr')).toBeTrue();
  });

  it('gives every compose box a unique id prefix so federated instances do not collide', () => {
    const second = TestBed.createComponent(ComposeBoxComponent).componentInstance;
    expect(component.ids.draft).not.toBe(second.ids.draft);
  });

  it('announces the live character count via aria-live and describes the textarea', () => {
    const count = el().querySelector('[data-testid="compose-char-count"]')!;
    expect(count.getAttribute('aria-live')).toBe('polite');
    const textarea = el().querySelector<HTMLTextAreaElement>('[data-testid="mastodon-input"]')!;
    expect(textarea.getAttribute('aria-describedby')).toBe(count.id);
  });

  it('marks the textarea invalid and surfaces an assertive alert when over the limit', () => {
    component.draft = 'x'.repeat(501);
    component['draftSig'].set(component.draft);
    fixture.detectChanges();
    const textarea = el().querySelector<HTMLTextAreaElement>('[data-testid="mastodon-input"]')!;
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    const alert = el().querySelector('[data-testid="compose-error"]')!;
    expect(alert).not.toBeNull();
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('exposes the CW and poll toggles as aria-pressed buttons reflecting their state', () => {
    const cw = el().querySelector('[data-testid="compose-cw-toggle"]')!;
    const poll = el().querySelector('[data-testid="compose-poll-toggle"]')!;
    expect(cw.getAttribute('aria-pressed')).toBe('false');
    expect(poll.getAttribute('aria-pressed')).toBe('false');
    component.toggleCw();
    component.togglePoll();
    fixture.detectChanges();
    expect(cw.getAttribute('aria-pressed')).toBe('true');
    expect(poll.getAttribute('aria-pressed')).toBe('true');
  });

  it('computes remaining characters and gates posting on the 500-char limit', () => {
    component.draft = 'hello';
    component['draftSig'].set('hello');
    expect(component.remaining()).toBe(495);
    expect(component.canPost()).toBeTrue();

    component.draft = 'x'.repeat(501);
    component['draftSig'].set(component.draft);
    expect(component.remaining()).toBeLessThan(0);
    expect(component.canPost()).toBeFalse();
  });

  it('posts the trimmed draft via the service and emits the created status', async () => {
    component.draft = '  hi there  ';
    component['draftSig'].set(component.draft);
    const created = makeStatus();
    mastodon.postStatus.and.resolveTo(created);

    const emitted: Status[] = [];
    component.posted.subscribe((s) => emitted.push(s));

    await component.submit();

    expect(mastodon.postStatus).toHaveBeenCalled();
    const [params] = mastodon.postStatus.calls.mostRecent().args;
    expect(params.status).toBe('hi there');
    expect(emitted).toEqual([created]);
  });

  it('announces a server-side submit rejection as an assertive alert and keeps the draft', async () => {
    // e.g. the account was banned/deactivated by a moderator: the homeserver
    // rejects POST /api/v1/statuses. The composer must ANNOUNCE the rejection
    // (role=alert, assertive) — never a silent no-op that looks like success —
    // and must not throw away the user's draft.
    component.draft = 'hello world';
    component['draftSig'].set(component.draft);
    mastodon.postStatus.and.rejectWith(new Error('POST /api/v1/statuses failed: 403'));

    await component.submit();
    fixture.detectChanges();

    const err = el().querySelector('[data-testid="compose-submit-error"]')!;
    expect(err).withContext('submit rejection must render an error').not.toBeNull();
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.getAttribute('aria-live')).toBe('assertive');
    expect(component.draft).withContext('draft must survive a rejected submit').toBe('hello world');
    expect(component.posting()).toBeFalse();

    // The next (successful) submit clears the stale alert.
    mastodon.postStatus.and.resolveTo(makeStatus());
    await component.submit();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="compose-submit-error"]')).toBeNull();
  });

  // ── Attachment alt text (the describe-input must actually reach the server) ─

  describe('attachment alt text (description) wiring', () => {
    function attachmentEvent(): Event {
      return { target: { files: [new File(['x'], 'pic.png', { type: 'image/png' })], value: '' } } as unknown as Event;
    }

    async function attachOne(): Promise<void> {
      component.togglePoison(); // direct upload path — the cloak leg is covered elsewhere
      mastodon.uploadMedia.and.resolveTo({
        id: 'm1', type: 'image', url: 'https://cdn/full.png', preview_url: 'https://cdn/small.png',
        remote_url: null, description: null, blurhash: null, meta: null,
      });
      await component.onFileSelected(attachmentEvent());
    }

    it('PUTs the typed description via updateMedia BEFORE posting (regression: the input was a dead control)', async () => {
      await attachOne();
      component.media.set(component.media().map((m) => ({ ...m, description: '  a red panda eating bamboo  ' })));
      component.draft = 'with alt text';
      component['draftSig'].set(component.draft);

      const order: string[] = [];
      mastodon.updateMedia.and.callFake(async () => {
        order.push('updateMedia');
        return { id: 'm1' } as never;
      });
      mastodon.postStatus.and.callFake(async () => {
        order.push('postStatus');
        return makeStatus();
      });

      await component.submit();

      // Trimmed description reached the server against the right attachment…
      expect(mastodon.updateMedia).toHaveBeenCalledWith('m1', { description: 'a red panda eating bamboo' });
      // …and BEFORE the status claimed the media (Mastodon rejects a
      // description update once the attachment is bound to a status).
      expect(order).toEqual(['updateMedia', 'postStatus']);
      const [params] = mastodon.postStatus.calls.mostRecent().args;
      expect(params.media_ids).toEqual(['m1']);
    });

    it('skips the PUT entirely when no description was typed (nothing to save)', async () => {
      await attachOne();
      component.draft = 'no alt text';
      component['draftSig'].set(component.draft);
      mastodon.postStatus.and.resolveTo(makeStatus());

      await component.submit();

      expect(mastodon.updateMedia).not.toHaveBeenCalled();
      expect(mastodon.postStatus).toHaveBeenCalled();
    });

    it('a failed description save ABORTS the post with an announced alert and keeps the draft', async () => {
      await attachOne();
      component.media.set(component.media().map((m) => ({ ...m, description: 'important alt text' })));
      component.draft = 'must not post silently without alt';
      component['draftSig'].set(component.draft);
      mastodon.updateMedia.and.rejectWith(new Error('PUT /api/v1/media/m1 failed: 500'));
      mastodon.postStatus.and.resolveTo(makeStatus());

      await component.submit();
      fixture.detectChanges();

      // Never quietly "posted, but your alt text went nowhere".
      expect(mastodon.postStatus).not.toHaveBeenCalled();
      const err = el().querySelector('[data-testid="compose-submit-error"]')!;
      expect(err).withContext('the failed alt-text save must be announced').not.toBeNull();
      expect((err.textContent ?? '').toLowerCase()).toContain('alt text');
      expect(component.draft).toBe('must not post silently without alt');
      expect(component.posting()).toBeFalse();
    });
  });

  // ── AI-cloak (poison-before-ingest) ────────────────────────────────────

  function fileEvent(file: File): Event {
    return { target: { files: [file], value: '' } } as unknown as Event;
  }
  function imageFile(): File {
    return new File(['x'], 'pic.png', { type: 'image/png' });
  }
  function protectedAtt(over: Partial<ProtectedMediaAttachment> = {}): ProtectedMediaAttachment {
    return {
      id: 'm1',
      type: 'image',
      url: 'https://cdn/full.png',
      preview_url: 'https://cdn/small.png',
      remote_url: null,
      description: null,
      blurhash: null,
      meta: null,
      cloak: { ref: 'r1', status: 'pending', mode: 'glaze', backend: 'cuda' },
      ...over,
    };
  }

  it('defaults the AI-cloak toggle ON and exposes it as an aria-pressed button', () => {
    expect(component.poisonImages()).toBeTrue();
    const toggle = el().querySelector('[data-testid="compose-poison-toggle"]')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toContain('AI-cloak: Glaze');
  });

  it('persists the per-user opt-out so it is honoured on the next compose box', () => {
    component.togglePoison();
    expect(component.poisonImages()).toBeFalse();
    expect(localStorage.getItem(POISON_DEFAULT_KEY)).toBe('off');
    const next = TestBed.createComponent(ComposeBoxComponent).componentInstance;
    expect(next.poisonImages()).toBeFalse();
  });

  it('renders the honest Off label when the toggle is off', () => {
    component.togglePoison();
    fixture.detectChanges();
    expect(component.cloakLabel()).toBe('Off');
    expect(el().querySelector('[data-testid="compose-poison-toggle"]')!.textContent).toContain('AI-cloak: Off');
  });

  it('shows Unavailable (not a protection claim) when the heavy tier is absent but ON', () => {
    component.cloakCapability.set({ available: false, backend: 'none', defaultMode: 'glaze' });
    expect(component.poisonImages()).toBeTrue();
    expect(component.cloakLabel()).toBe('Unavailable');
  });

  it('routes an image upload through the BFF proxy when ON, never the direct path', async () => {
    mastodon.uploadMediaProtected.and.resolveTo(protectedAtt());
    await component.onFileSelected(fileEvent(imageFile()));
    expect(mastodon.uploadMediaProtected).toHaveBeenCalled();
    expect(mastodon.uploadMedia).not.toHaveBeenCalled();
    const [, mode] = mastodon.uploadMediaProtected.calls.mostRecent().args;
    expect(mode).toBe('glaze');
    expect(component.media()[0].protection).toBe('pending');
  });

  it('uses the direct (un-cloaked) upload when the toggle is OFF', async () => {
    component.togglePoison();
    mastodon.uploadMedia.and.resolveTo(protectedAtt({ cloak: undefined }));
    await component.onFileSelected(fileEvent(imageFile()));
    expect(mastodon.uploadMedia).toHaveBeenCalled();
    expect(mastodon.uploadMediaProtected).not.toHaveBeenCalled();
    expect(component.media()[0].protection).toBe('off');
  });

  it('warns-before-post and forwards un-cloaked when ON but the heavy tier is absent', async () => {
    component.cloakCapability.set({ available: false, backend: 'none', defaultMode: 'glaze' });
    mastodon.uploadMedia.and.resolveTo(protectedAtt({ cloak: undefined }));
    await component.onFileSelected(fileEvent(imageFile()));
    expect(mastodon.uploadMediaProtected).not.toHaveBeenCalled();
    expect(mastodon.uploadMedia).toHaveBeenCalled();
    expect(component.cloakUnavailableNotice()).toBeTrue();
    expect(component.media()[0].protection).toBe('unavailable');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="compose-cloak-unavailable"]')).not.toBeNull();
  });

  it('forwards non-image media un-cloaked even when ON (cloak is image-only)', async () => {
    mastodon.uploadMedia.and.resolveTo(protectedAtt({ type: 'video', cloak: undefined }));
    const video = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    await component.onFileSelected(fileEvent(video));
    expect(mastodon.uploadMediaProtected).not.toHaveBeenCalled();
    expect(mastodon.uploadMedia).toHaveBeenCalled();
  });

  it('the escape hatch flips a cloaking attachment to skipped (honest, not "protected")', async () => {
    mastodon.uploadMediaProtected.and.resolveTo(protectedAtt());
    mastodon.cloakStatus.and.resolveTo({ ref: 'r1', status: 'pending', mode: 'glaze', backend: 'cuda' });
    await component.onFileSelected(fileEvent(imageFile()));
    const id = component.media()[0].id;
    expect(component.isCloaking(component.media()[0])).toBeTrue();
    component.postWithoutProtection(id);
    const m = component.media()[0];
    expect(m.protection).toBe('skipped');
    expect(m.cloakRef).toBeNull();
    expect(component.badgeText(m)).toBe('Posted without AI-cloak');
  });

  it('renders the per-attachment badge with honest copy and an escape hatch while cloaking', async () => {
    mastodon.uploadMediaProtected.and.resolveTo(protectedAtt());
    mastodon.cloakStatus.and.resolveTo({ ref: 'r1', status: 'pending', mode: 'glaze', backend: 'cuda' });
    await component.onFileSelected(fileEvent(imageFile()));
    fixture.detectChanges();
    const badge = el().querySelector('[data-testid="compose-cloak-badge"]')!;
    expect(badge.textContent).toContain('Applying AI-cloak');
    expect(el().querySelector('[data-testid="compose-cloak-escape"]')).not.toBeNull();
  });

  it('never claims "protected" wording for a degraded outcome', () => {
    const m = {
      id: 'x', preview: null, description: '', processing: false, filename: 'f',
      protection: 'degraded' as const, cloakRef: null, cloakMode: 'glaze' as const,
    };
    expect(component.badgeText(m)).not.toContain('applied');
    expect(component.badgeText(m).toLowerCase()).toContain('weakened');
  });

  it('spells out the opt-out semantics in the AI-cloak toggle title (default-ON, toggle off to opt out)', () => {
    const toggle = el().querySelector('[data-testid="compose-poison-toggle"]')!;
    const title = (toggle.getAttribute('title') ?? '').toLowerCase();
    expect(title).toContain('opt out');
    expect(title).toContain('default');
  });

  // ── Voice & video messages (recorder) ────────────────────────────────────

  function voiceFile(): File {
    return new File(['opus-bytes'], 'voice-message-2026-07-15.webm', { type: 'audio/webm' });
  }
  function videoTakeFile(): File {
    return new File(['vp9-bytes'], 'video-message-2026-07-15.webm', { type: 'video/webm' });
  }
  /** A take REPORTING a size over the 64 MiB cap without allocating 64 MiB —
   *  an own `size` property shadows the Blob.prototype accessor. */
  function oversizeVoiceFile(): File {
    const f = voiceFile();
    Object.defineProperty(f, 'size', { value: MAX_RECORDED_UPLOAD_BYTES + 1 });
    return f;
  }

  describe('voice & video messages', () => {
    it('shows the mic and camera record buttons beside the attach control when supported', () => {
      const audioBtn = el().querySelector<HTMLButtonElement>('[data-testid="compose-record-audio"]')!;
      const videoBtn = el().querySelector<HTMLButtonElement>('[data-testid="compose-record-video"]')!;
      expect(audioBtn).withContext('mic button must render').not.toBeNull();
      expect(videoBtn).withContext('camera button must render').not.toBeNull();
      expect(audioBtn.getAttribute('aria-label')).toBe('Record a voice message');
      expect(videoBtn.getAttribute('aria-label')).toBe('Record a video message');
      expect(audioBtn.disabled).toBeFalse();
      expect(videoBtn.disabled).toBeFalse();
    });

    it('HIDES (not merely disables) the record buttons when the browser is unsupported', () => {
      recorder.isSupported.and.returnValue(false);
      const bare = TestBed.createComponent(ComposeBoxComponent);
      bare.detectChanges();
      const root = bare.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="compose-record-audio"]')).toBeNull();
      expect(root.querySelector('[data-testid="compose-record-video"]')).toBeNull();
      // The rest of the composer stays fully usable (fail-soft).
      expect(root.querySelector('[data-testid="compose-media-input"]')).not.toBeNull();
    });

    it('the mic button starts an audio recording, the camera button a video recording', async () => {
      (el().querySelector('[data-testid="compose-record-audio"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(recorder.startAudio).toHaveBeenCalled();
      (el().querySelector('[data-testid="compose-record-video"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(recorder.startVideo).toHaveBeenCalled();
    });

    it('while recording: pulsing indicator + mm:ss clock in an aria-live status, Stop and Cancel', () => {
      recorder.state.set('recording');
      recorder.kind.set('audio');
      recorder.elapsedSeconds.set(65);
      fixture.detectChanges();

      const status = el().querySelector('[data-testid="compose-recorder-status"]')!;
      expect(status).withContext('recording status must render').not.toBeNull();
      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
      expect(status.querySelector('.recorder-pulse')).withContext('pulsing indicator').not.toBeNull();
      expect(el().querySelector('[data-testid="compose-recorder-elapsed"]')!.textContent).toContain('01:05');
      expect(el().querySelector('[data-testid="compose-recorder-stop"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="compose-recorder-cancel"]')).not.toBeNull();
      // The record buttons grey out — only one take at a time.
      expect((el().querySelector('[data-testid="compose-record-audio"]') as HTMLButtonElement).disabled).toBeTrue();
      expect((el().querySelector('[data-testid="compose-record-video"]') as HTMLButtonElement).disabled).toBeTrue();
    });

    it('a video recording shows the live (muted) camera preview', () => {
      recorder.state.set('recording');
      recorder.kind.set('video');
      fixture.detectChanges();
      const live = el().querySelector<HTMLVideoElement>('[data-testid="compose-recorder-live"]')!;
      expect(live).withContext('live self-view must render for video').not.toBeNull();
      expect(live.muted).withContext('self-view must never loop the mic back').toBeTrue();
      // …and not for audio-only recordings.
      recorder.kind.set('audio');
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="compose-recorder-live"]')).toBeNull();
    });

    it('Stop delegates to the service; Cancel discards via the service', () => {
      recorder.state.set('recording');
      recorder.kind.set('audio');
      fixture.detectChanges();
      (el().querySelector('[data-testid="compose-recorder-stop"]') as HTMLButtonElement).click();
      expect(recorder.stop).toHaveBeenCalled();
      (el().querySelector('[data-testid="compose-recorder-cancel"]') as HTMLButtonElement).click();
      expect(recorder.cancel).toHaveBeenCalled();
    });

    it('adopts a finished take (Stop or the 300s auto-cap) into an audio preview with Attach/Discard', () => {
      recorder.take.set(voiceFile());
      fixture.detectChanges(); // ngDoCheck adopts the take
      expect(recorder.clearTake).withContext('the take is consumed from the service').toHaveBeenCalled();
      expect(component.pendingTake()).not.toBeNull();
      expect(component.pendingTake()!.kind).toBe('audio');
      const takePanel = el().querySelector('[data-testid="compose-recorder-take"]')!;
      expect(takePanel).not.toBeNull();
      expect(takePanel.querySelector('[data-testid="compose-recorder-take-audio"]')).not.toBeNull();
      expect(takePanel.querySelector('[data-testid="compose-recorder-attach"]')).not.toBeNull();
      expect(takePanel.querySelector('[data-testid="compose-recorder-discard"]')).not.toBeNull();
    });

    it('previews a video take with a playback <video>, not an <audio>', () => {
      recorder.take.set(videoTakeFile());
      fixture.detectChanges();
      expect(component.pendingTake()!.kind).toBe('video');
      expect(el().querySelector('[data-testid="compose-recorder-take-video"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="compose-recorder-take-audio"]')).toBeNull();
    });

    it('Attach feeds the recorded File through the SAME uploadMedia path as a picked audio/video file — NEVER the image-cloak route, even with AI-cloak ON', async () => {
      expect(component.poisonImages()).withContext('precondition: cloak default ON').toBeTrue();
      mastodon.uploadMedia.and.resolveTo(protectedAtt({ id: 'vm1', type: 'audio', cloak: undefined }));
      recorder.take.set(voiceFile());
      fixture.detectChanges();

      await component.attachTake();

      expect(mastodon.uploadMedia).toHaveBeenCalled();
      const [uploaded] = mastodon.uploadMedia.calls.mostRecent().args;
      expect(uploaded.name).toBe('voice-message-2026-07-15.webm');
      expect(uploaded.type).toBe('audio/webm');
      expect(mastodon.uploadMediaProtected).withContext('cloak is image-only').not.toHaveBeenCalled();
      // Lands in the ordinary pending-media list (same limits/submit flow).
      expect(component.media().length).toBe(1);
      expect(component.media()[0].id).toBe('vm1');
      expect(component.pendingTake()).withContext('the take preview is consumed').toBeNull();
    });

    it('Discard throws the take away without uploading anything', () => {
      recorder.take.set(voiceFile());
      fixture.detectChanges();
      (el().querySelector('[data-testid="compose-recorder-discard"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(component.pendingTake()).toBeNull();
      expect(mastodon.uploadMedia).not.toHaveBeenCalled();
      expect(mastodon.uploadMediaProtected).not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="compose-recorder-take"]')).toBeNull();
    });

    it('surfaces a permission-denied refusal as a polite fail-soft status', () => {
      recorder.error.set('permission-denied');
      fixture.detectChanges();
      const err = el().querySelector('[data-testid="compose-recorder-error"]')!;
      expect(err).not.toBeNull();
      expect(err.getAttribute('role')).toBe('status');
      expect(err.getAttribute('aria-live')).toBe('polite');
      expect((err.textContent ?? '').toLowerCase()).toContain('denied');
      // Composer itself stays usable.
      expect(el().querySelector('[data-testid="mastodon-input"]')).not.toBeNull();
    });

    it('disables the record buttons while a post is submitting', () => {
      component.posting.set(true);
      fixture.detectChanges();
      expect((el().querySelector('[data-testid="compose-record-audio"]') as HTMLButtonElement).disabled).toBeTrue();
      expect((el().querySelector('[data-testid="compose-record-video"]') as HTMLButtonElement).disabled).toBeTrue();
    });

    it('exposes the record buttons as aria-pressed toggles reflecting the live recording kind', () => {
      const audioBtn = () => el().querySelector('[data-testid="compose-record-audio"]')!;
      const videoBtn = () => el().querySelector('[data-testid="compose-record-video"]')!;
      expect(audioBtn().getAttribute('aria-pressed')).toBe('false');
      expect(videoBtn().getAttribute('aria-pressed')).toBe('false');
      recorder.state.set('recording');
      recorder.kind.set('audio');
      fixture.detectChanges();
      expect(audioBtn().getAttribute('aria-pressed')).toBe('true');
      expect(videoBtn().getAttribute('aria-pressed')).toBe('false');
      recorder.kind.set('video');
      fixture.detectChanges();
      expect(audioBtn().getAttribute('aria-pressed')).toBe('false');
      expect(videoBtn().getAttribute('aria-pressed')).toBe('true');
    });

    it('BOUNDS the elapsed clock display at the 05:00 cap even if a stray tick races past it', () => {
      recorder.state.set('recording');
      recorder.kind.set('audio');
      recorder.elapsedSeconds.set(99_999); // pathological: ticker outlived the cap
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="compose-recorder-elapsed"]')!.textContent).toContain('05:00');
    });

    it('REFUSES to attach a take over the 64 MiB cap: polite aria-live error, nothing uploaded, Discard still available', async () => {
      recorder.take.set(oversizeVoiceFile());
      fixture.detectChanges(); // adopt the take

      await component.attachTake();
      fixture.detectChanges();

      // Nothing left the browser on either upload path.
      expect(mastodon.uploadMedia).not.toHaveBeenCalled();
      expect(mastodon.uploadMediaProtected).not.toHaveBeenCalled();
      // Polite (never assertive — the composer stays usable) live-region error.
      const err = el().querySelector('[data-testid="compose-take-error"]')!;
      expect(err).withContext('size refusal must be announced').not.toBeNull();
      expect(err.getAttribute('role')).toBe('status');
      expect(err.getAttribute('aria-live')).toBe('polite');
      expect(err.textContent).toContain('64 MiB');
      // The preview is kept so the user can replay/decide; Discard clears it AND the error.
      expect(component.pendingTake()).not.toBeNull();
      (el().querySelector('[data-testid="compose-recorder-discard"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(component.pendingTake()).toBeNull();
      expect(el().querySelector('[data-testid="compose-take-error"]')).toBeNull();
    });

    it('attaches a take exactly AT the 64 MiB boundary (the cap is inclusive)', async () => {
      const f = voiceFile();
      Object.defineProperty(f, 'size', { value: MAX_RECORDED_UPLOAD_BYTES });
      mastodon.uploadMedia.and.resolveTo(protectedAtt({ id: 'vm-max', type: 'audio', cloak: undefined }));
      recorder.take.set(f);
      fixture.detectChanges();
      await component.attachTake();
      expect(mastodon.uploadMedia).toHaveBeenCalled();
      expect(component.takeError()).toBeNull();
    });
  });

  // ── Local-only / domain-lock (DISABLED + helptext, intentionally unwired) ──

  it('renders the local-only toggle as aria-disabled (NOT native disabled) so it stays focusable', () => {
    const btn = el().querySelector('[data-testid="compose-local-only-toggle"]')!;
    expect(btn).withContext('local-only control must be present').not.toBeNull();
    // aria-disabled, never the native disabled attribute (which removes it from
    // the tab order and stops a screen reader announcing the why-helptext).
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.hasAttribute('disabled')).withContext('must not use native disabled').toBeFalse();
    expect((btn as HTMLButtonElement).disabled).toBeFalse();
  });

  it('associates the local-only control with its why-helptext via aria-describedby', () => {
    const btn = el().querySelector('[data-testid="compose-local-only-toggle"]')!;
    const describedBy = btn.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const help = el().querySelector(`#${describedBy}`)!;
    expect(help).withContext('aria-describedby must resolve to a real element').not.toBeNull();
    expect(help.getAttribute('data-testid')).toBe('compose-local-only-help');
    expect(help.classList).toContain('field-help');
    // Honest copy: explains it is unavailable, never implies a post stayed local.
    expect((help.textContent ?? '').toLowerCase()).toContain("isn't available yet");
  });

  it('does NOT wire the local-only control to any post param (no backend flag exists)', async () => {
    mastodon.postStatus.and.resolveTo(makeStatus());
    component.draft = 'hello world';
    fixture.detectChanges();
    await component.submit();
    const [params] = mastodon.postStatus.calls.mostRecent().args;
    // local_only / local-only must never leak into the submitted params.
    expect(JSON.stringify(params).toLowerCase()).not.toContain('local_only');
    expect(JSON.stringify(params).toLowerCase()).not.toContain('local-only');
  });

  it('NOT domain-locked: local-only stays the honest "not available yet" indicator', () => {
    // The default beforeEach session is absent → not domain-locked.
    expect(component.domainLocked()).toBeFalse();
    const btn = el().querySelector('[data-testid="compose-local-only-toggle"]')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    const help = el().querySelector('[data-testid="compose-local-only-help"]')!;
    expect((help.textContent ?? '').toLowerCase()).toContain("isn't available yet");
    // The visibility picker is fully open — no option disabled.
    const opts = el().querySelectorAll<HTMLOptionElement>('[data-testid="compose-visibility"] option');
    expect(Array.from(opts).some((o) => o.disabled)).toBeFalse();
    expect(el().querySelector('[data-testid="compose-visibility-help"]')).toBeNull();
  });

  // ── Social LOCAL-ONLY enforcement (domain-locked) ─────────────────────────

  describe('when the session carries the MASTODON_DOMAINLOCKED marker', () => {
    let locked: ComponentFixture<ComposeBoxComponent>;
    let lockedCmp: ComposeBoxComponent;

    function lockedEl(): HTMLElement {
      return locked.nativeElement as HTMLElement;
    }

    // Seed the marker (lowercased on-wire form from admin-bff domainlockRoles)
    // BEFORE creating the component, then broadcast so the root SessionService —
    // already constructed by the outer beforeEach — re-reads it.
    function buildLocked(roles: string[] = ['user', 'mastodon_domainlocked']): void {
      seedSession(roles);
      window.dispatchEvent(new Event('hug-session-change'));
      locked = TestBed.createComponent(ComposeBoxComponent);
      lockedCmp = locked.componentInstance;
      locked.detectChanges();
    }

    it('reports domainLocked() true for the lowercased on-wire marker', () => {
      buildLocked();
      expect(lockedCmp.domainLocked()).toBeTrue();
    });

    it('also accepts the ROLE_-prefixed / upper-case marker variant defensively', () => {
      buildLocked(['ROLE_USER', 'ROLE_MASTODON_DOMAINLOCKED']);
      expect(lockedCmp.domainLocked()).toBeTrue();
    });

    it('coerces the default public visibility down to a non-federated value', () => {
      buildLocked();
      // ngDoCheck (fired by detectChanges) coerces 'public' → 'private'.
      expect(lockedCmp.isFederatedVisibility(lockedCmp.visibility)).toBeFalse();
      expect(lockedCmp.visibility).toBe('private');
    });

    it('disables the federated-reach visibility options (public + unlisted) but not followers/direct', () => {
      buildLocked();
      const byValue = (v: string) =>
        lockedEl().querySelector<HTMLOptionElement>(`[data-testid="compose-visibility"] option[value="${v}"]`)!;
      expect(byValue('public').disabled).withContext('public is a federated reach').toBeTrue();
      expect(byValue('unlisted').disabled).withContext('unlisted is a federated reach').toBeTrue();
      expect(byValue('private').disabled).withContext('followers stays selectable').toBeFalse();
      expect(byValue('direct').disabled).withContext('direct stays selectable').toBeFalse();
    });

    it('wires why-helptext on the visibility picker via aria-describedby', () => {
      buildLocked();
      const select = lockedEl().querySelector('[data-testid="compose-visibility"]')!;
      const describedBy = select.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const help = lockedEl().querySelector(`#${describedBy}`)!;
      expect(help.getAttribute('data-testid')).toBe('compose-visibility-help');
      expect((help.textContent ?? '').toLowerCase()).toContain('domain-locked');
    });

    it('shows the local-only indicator ENFORCED (aria-disabled, pressed) with lock helptext', () => {
      buildLocked();
      const btn = lockedEl().querySelector('[data-testid="compose-local-only-toggle"]')!;
      // aria-disabled (focusable, NOT native disabled) so a screen reader reads the WHY.
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.hasAttribute('disabled')).withContext('must not use native disabled').toBeFalse();
      expect((btn as HTMLButtonElement).disabled).toBeFalse();
      expect(btn.getAttribute('aria-pressed')).withContext('enforced ON').toBe('true');
      // helptext via aria-describedby explains the lock honestly.
      const describedBy = btn.getAttribute('aria-describedby');
      const help = lockedEl().querySelector(`#${describedBy}`)!;
      expect((help.textContent ?? '').toLowerCase()).toContain('domain-locked');
      expect((help.textContent ?? '').toLowerCase()).toContain("won't federate");
    });

    it('keeps local posting usable: submits a NON-federated visibility, never public', async () => {
      buildLocked();
      mastodon.postStatus.and.resolveTo(makeStatus());
      lockedCmp.draft = 'a local hello';
      locked.detectChanges();
      expect(lockedCmp.canPost()).withContext('local posting stays usable').toBeTrue();
      await lockedCmp.submit();
      const [params] = mastodon.postStatus.calls.mostRecent().args;
      expect(params.visibility).not.toBe('public');
      expect(params.visibility).not.toBe('unlisted');
      expect(['private', 'direct']).toContain(params.visibility!);
    });

    it('defence-in-depth: a federated visibility forced past the UI is coerced at submit', async () => {
      buildLocked();
      mastodon.postStatus.and.resolveTo(makeStatus());
      lockedCmp.draft = 'sneaky public';
      // Bypass the disabled UI by setting the bound value directly, skip ngDoCheck.
      lockedCmp.visibility = 'public';
      await lockedCmp.submit();
      const [params] = mastodon.postStatus.calls.mostRecent().args;
      expect(params.visibility).not.toBe('public');
    });

    it('does NOT down-coerce an already non-federated choice (followers stays followers)', () => {
      buildLocked();
      lockedCmp.visibility = 'direct';
      locked.detectChanges(); // ngDoCheck must leave a non-federated value alone
      expect(lockedCmp.visibility).toBe('direct');
    });
  });
});
