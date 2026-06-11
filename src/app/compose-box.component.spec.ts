import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComposeBoxComponent, POISON_DEFAULT_KEY } from './compose-box.component';
import { MastodonService, ProtectedMediaAttachment, Status } from './mastodon.service';

function makeStatus(over: Partial<Status> = {}): Status {
  return { id: 'posted', reblog: null, ...over } as Status;
}

describe('ComposeBoxComponent', () => {
  let fixture: ComponentFixture<ComposeBoxComponent>;
  let component: ComposeBoxComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  beforeEach(async () => {
    localStorage.clear();
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'postStatus',
      'uploadMedia',
      'uploadMediaProtected',
      'getMedia',
      'cloakCapability',
      'cloakStatus',
    ]);
    // The composer queries capability on construction; default to the heavy
    // tier present so the shield renders an available 'Glaze' state.
    mastodon.cloakCapability.and.resolveTo({ available: true, backend: 'cuda', defaultMode: 'glaze' });

    await TestBed.configureTestingModule({
      imports: [ComposeBoxComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }],
    }).compileComponents();

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
});
