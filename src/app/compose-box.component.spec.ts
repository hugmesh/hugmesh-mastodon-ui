import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComposeBoxComponent, POISON_DEFAULT_KEY } from './compose-box.component';
import { MastodonService, ProtectedMediaAttachment, Status } from './mastodon.service';
import { SnapSession } from './session.service';

function makeStatus(over: Partial<Status> = {}): Status {
  return { id: 'posted', reblog: null, ...over } as Status;
}

/** Write a session into localStorage BEFORE the component is created so the
 *  root SessionService hydrates it. `roles` carries the domain-lock marker in
 *  its on-the-wire (lowercased) form for the locked cases. */
function seedSession(roles: string[]): void {
  const session: SnapSession = {
    id: 'google:alice@gmail.com',
    label: 'alice@gmail.com',
    provider: 'google',
    roles,
    registrationComplete: true,
  };
  localStorage.setItem('snap.session', JSON.stringify(session));
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
      window.dispatchEvent(new Event('snap-session-change'));
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
