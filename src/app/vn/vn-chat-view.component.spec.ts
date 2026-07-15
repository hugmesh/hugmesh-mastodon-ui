import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { VnChatViewComponent } from './vn-chat-view.component';
import { SceneService, VnSceneManifest } from './scene.service';
import { MastodonService, Account, Conversation, Status } from '../mastodon.service';
import { AppearancePreferences, BUILTIN_DEFAULT, PreferencesService } from '../preferences.service';
import { ComposeBoxComponent } from '../compose-box.component';

const MANIFEST: VnSceneManifest = {
  schemaVersion: 1,
  scenes: [
    { id: 'vn_scene_bedroom', displayName: 'Bedroom', file: 'vn_scene_bedroom.svg', tags: [] },
    { id: 'vn_scene_cafe', displayName: 'Café', file: 'vn_scene_cafe.svg', tags: [] },
  ],
  props: [
    { id: 'vn_prop_lamp', displayName: 'Lamp', file: 'vn_prop_lamp.svg' },
    { id: 'vn_prop_books', displayName: 'Books', file: 'vn_prop_books.svg' },
  ],
};

function makeAccount(id: string, name: string): Account {
  return {
    id,
    username: name.toLowerCase(),
    acct: name.toLowerCase(),
    display_name: name,
    avatar: `${name.toLowerCase()}.png`,
  } as Account;
}

const alice = makeAccount('a1', 'Alice');
const bob = makeAccount('b1', 'Bob');

function makeStatus(id: string, account: Account, createdAt: string, over: Partial<Status> = {}): Status {
  return {
    id,
    uri: '',
    url: null,
    created_at: createdAt,
    edited_at: null,
    content: `<p>message ${id}</p>`,
    visibility: 'direct',
    sensitive: false,
    spoiler_text: '',
    language: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    account,
    media_attachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    reblog: null,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    poll: null,
    card: null,
    ...over,
  } as Status;
}

const s1 = makeStatus('s1', alice, '2026-07-01T10:00:00.000Z');
const s2 = makeStatus('s2', bob, '2026-07-01T10:05:00.000Z');
const s3 = makeStatus('s3', alice, '2026-07-01T10:10:00.000Z', {
  content: '<p>see you <script>alert(1)</script>soon</p>',
  in_reply_to_id: 's2',
  media_attachments: [
    {
      id: 'm1',
      type: 'image',
      url: 'full.png',
      preview_url: 'preview.png',
      remote_url: null,
      description: 'a sticker',
      blurhash: null,
      meta: null,
    },
  ],
});

function makeConversation(over: Partial<Conversation> = {}): Conversation {
  return { id: 'c1', unread: false, accounts: [bob], last_status: s2, ...over };
}

describe('VnChatViewComponent', () => {
  let fixture: ComponentFixture<VnChatViewComponent>;
  let component: VnChatViewComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;
  let prefsSig: ReturnType<typeof signal<AppearancePreferences>>;
  let prefsSubject: BehaviorSubject<AppearancePreferences>;
  let setSpy: jasmine.Spy;

  /** Push a preference change through BOTH surfaces the stub exposes (the
   *  signal the computeds read + the prefs$ stream the stage-resolver follows),
   *  mirroring how the real service's commit() fans out. */
  function setPrefs(patch: Partial<AppearancePreferences>): void {
    prefsSig.set({ ...prefsSig(), ...patch });
    prefsSubject.next(prefsSig());
  }

  const flush = () => new Promise<void>((r) => setTimeout(r));

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', ['getContext']);
    mastodon.getContext.and.resolveTo({ ancestors: [s1], descendants: [s3] });

    prefsSig = signal<AppearancePreferences>({ ...BUILTIN_DEFAULT, reducedMotion: false });
    prefsSubject = new BehaviorSubject<AppearancePreferences>(prefsSig());
    setSpy = jasmine.createSpy('set');
    const prefsStub = {
      prefs: prefsSig,
      prefs$: prefsSubject.asObservable(),
      set: setSpy,
    } as unknown as PreferencesService;

    const sceneStub = {
      manifest: () => Promise.resolve(MANIFEST),
      scenes: () => Promise.resolve(MANIFEST.scenes),
      props: () => Promise.resolve(MANIFEST.props),
      sceneUrl: (id: string) =>
        Promise.resolve(MANIFEST.scenes.some((s) => s.id === id) ? `assets/vn/scenes/${id}.svg` : null),
      propUrl: (id: string) =>
        Promise.resolve(MANIFEST.props.some((p) => p.id === id) ? `assets/vn/scenes/${id}.svg` : null),
      assetUrl: (file: string) => `assets/vn/scenes/${file}`,
    } as unknown as SceneService;

    // Deterministic reduced-motion baseline regardless of the CI browser's OS.
    spyOn(window, 'matchMedia').and.callFake(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );

    await TestBed.configureTestingModule({
      imports: [VnChatViewComponent],
      providers: [
        { provide: MastodonService, useValue: mastodon },
        { provide: PreferencesService, useValue: prefsStub },
        { provide: SceneService, useValue: sceneStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VnChatViewComponent);
    component = fixture.componentInstance;
  });

  async function render(conv: Conversation = makeConversation()): Promise<void> {
    component.conversation = conv;
    await flush(); // let getContext + stage resolution settle
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(selector: string): string {
    return el().querySelector(selector)?.textContent?.trim() ?? '';
  }

  // ── thread assembly + navigation ─────────────────────────────────────────

  it('builds the chronological thread from last_status + its context and opens at the LATEST message', async () => {
    await render();
    expect(mastodon.getContext).toHaveBeenCalledWith('s2');
    expect(component.thread().map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(text('[data-testid="vn-position"]')).toBe('3 / 3');
    expect(text('[data-testid="vn-nameplate"]')).toBe('Alice');
  });

  it('Prev/Next walk the thread and disable honestly at the bounds; Latest jumps to the newest', async () => {
    await render();
    const btn = (id: string) => el().querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

    expect(btn('vn-next').disabled).withContext('already at the latest').toBeTrue();
    expect(btn('vn-latest').disabled).toBeTrue();

    btn('vn-prev').click();
    fixture.detectChanges();
    expect(text('[data-testid="vn-nameplate"]')).toBe('Bob');
    expect(text('[data-testid="vn-position"]')).toBe('2 / 3');

    btn('vn-prev').click();
    fixture.detectChanges();
    expect(text('[data-testid="vn-position"]')).toBe('1 / 3');
    expect(btn('vn-prev').disabled).withContext('at the oldest message').toBeTrue();

    btn('vn-latest').click();
    fixture.detectChanges();
    expect(text('[data-testid="vn-position"]')).toBe('3 / 3');
    expect(text('[data-testid="vn-nameplate"]')).toBe('Alice');
  });

  it('fails soft to a one-message thread when the context fetch degrades to empty', async () => {
    mastodon.getContext.and.resolveTo({ ancestors: [], descendants: [] });
    await render();
    expect(component.thread().map((s) => s.id)).toEqual(['s2']);
    expect(text('[data-testid="vn-position"]')).toBe('1 / 1');
  });

  // ── speaker highlighting ─────────────────────────────────────────────────

  it('lights the CURRENT message sender sprite and dims the others, following navigation', async () => {
    await render();
    const sprite = (id: string) => el().querySelector(`[data-testid="vn-sprite-${id}"]`)!;

    // latest message (s3) is Alice's
    expect(sprite('a1').classList).toContain('is-speaking');
    expect(sprite('b1').classList).toContain('is-dimmed');

    component.prev(); // s2 — Bob speaks
    fixture.detectChanges();
    expect(sprite('b1').classList).toContain('is-speaking');
    expect(sprite('b1').classList).not.toContain('is-dimmed');
    expect(sprite('a1').classList).toContain('is-dimmed');
  });

  it('renders a sprite for every participant: conversation accounts plus thread-only authors', async () => {
    await render();
    const sprites = el().querySelectorAll('[data-testid="vn-sprites"] .vn-sprite');
    expect(sprites.length).toBe(2); // bob (conversation.accounts) + alice (thread author)
  });

  // ── typewriter / reduced motion ──────────────────────────────────────────

  it('applies the typewriter reveal class by default (no reduced-motion preference)', async () => {
    await render();
    expect(el().querySelector('[data-testid="vn-dialog-text"]')!.classList).toContain('vn-typewriter');
  });

  it('drops the typewriter class when the user prefers reduced motion', async () => {
    await render();
    setPrefs({ reducedMotion: true });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="vn-dialog-text"]')!.classList).not.toContain('vn-typewriter');
  });

  // ── content safety ───────────────────────────────────────────────────────

  it('renders message content through the SAME sanitizer gate as toot-card (script stripped)', async () => {
    await render(); // latest = s3, which carries a script payload
    const body = el().querySelector('[data-testid="vn-dialog-text"]')!;
    expect(body.innerHTML).not.toContain('<script');
    expect(body.textContent).toContain('see you');
  });

  // ── stage: scene + props from preferences ────────────────────────────────

  it('renders the preferred scene background and enabled props from the shipped manifest', async () => {
    setPrefs({ chatVnScene: 'vn_scene_cafe', chatVnProps: 'vn_prop_lamp' });
    await render();
    const bg = el().querySelector<HTMLImageElement>('[data-testid="vn-scene-bg"]')!;
    expect(bg.getAttribute('src')).toContain('vn_scene_cafe');
    expect(el().querySelector('[data-testid="vn-stage-prop-vn_prop_lamp"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="vn-stage-prop-vn_prop_books"]')).toBeNull();
  });

  it('falls back to the default scene when the saved scene id is stale/unknown', async () => {
    setPrefs({ chatVnScene: 'vn_scene_deleted' });
    await render();
    const bg = el().querySelector<HTMLImageElement>('[data-testid="vn-scene-bg"]')!;
    expect(bg.getAttribute('src')).toContain('vn_scene_bedroom');
  });

  // ── media polaroid ───────────────────────────────────────────────────────

  it('renders the current message media as a polaroid card on-stage', async () => {
    await render(); // latest = s3 with one image attachment
    const polaroid = el().querySelector('[data-testid="vn-polaroids"] .vn-polaroid')!;
    expect(polaroid).not.toBeNull();
    expect(polaroid.querySelector('img')?.getAttribute('src')).toBe('preview.png');
    expect(polaroid.querySelector('img')?.getAttribute('alt')).toBe('a sticker');

    component.prev(); // s2 has no media
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="vn-polaroids"]')).toBeNull();
  });

  // ── reply seam ───────────────────────────────────────────────────────────

  it('embeds the existing compose box replying DIRECT to the newest status', async () => {
    await render();
    const compose = fixture.debugElement.query(By.directive(ComposeBoxComponent))
      .componentInstance as ComposeBoxComponent;
    expect(compose.inReplyToId).toBe('s3');
    expect(compose.visibility).toBe('direct');
  });

  it('a posted reply appends to the thread, jumps to it, and re-emits posted', async () => {
    await render();
    const emitted: Status[] = [];
    component.posted.subscribe((s) => emitted.push(s));
    const s4 = makeStatus('s4', bob, '2026-07-01T10:15:00.000Z', { in_reply_to_id: 's3' });

    component.onReplied(s4);
    fixture.detectChanges();

    expect(component.thread().map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(text('[data-testid="vn-position"]')).toBe('4 / 4');
    expect(text('[data-testid="vn-nameplate"]')).toBe('Bob');
    expect(emitted).toEqual([s4]);
  });

  // ── limits / overflow hardening ──────────────────────────────────────────

  it('clamps an over-long message at 1000 chars with a keyboard-operable "Show full message" expander', async () => {
    const longText = 'y'.repeat(1500);
    mastodon.getContext.and.resolveTo({ ancestors: [], descendants: [] });
    await render(
      makeConversation({
        last_status: makeStatus('long1', bob, '2026-07-01T11:00:00.000Z', { content: `<p>${longText}</p>` }),
      }),
    );

    const body = () => el().querySelector('[data-testid="vn-dialog-text"]')!;
    expect(body().textContent!.length).toBeLessThanOrEqual(1001); // 1000 chars + '…'
    expect(body().textContent).toContain('…');

    const expand = el().querySelector<HTMLButtonElement>('[data-testid="vn-dialog-expand"]')!;
    expect(expand).withContext('expander must render for a clamped message').not.toBeNull();
    expect(expand.getAttribute('aria-expanded')).toBe('false');

    expand.click();
    fixture.detectChanges();
    expect(body().textContent!.length).toBeGreaterThan(1400);
    expect(el().querySelector('[data-testid="vn-dialog-expand"]')!.getAttribute('aria-expanded')).toBe('true');
    expect(el().querySelector('[data-testid="vn-dialog-expand"]')!.textContent).toContain('Show less');
  });

  it('never renders an expander for a normal-length message', async () => {
    await render();
    expect(el().querySelector('[data-testid="vn-dialog-expand"]')).toBeNull();
  });

  it('re-clamps when navigating away from an expanded long message', async () => {
    const longText = 'z'.repeat(1500);
    mastodon.getContext.and.resolveTo({
      ancestors: [s1],
      descendants: [makeStatus('long2', alice, '2026-07-01T11:00:00.000Z', { content: `<p>${longText}</p>` })],
    });
    await render();
    component.toggleExpanded();
    fixture.detectChanges();
    component.prev(); // navigation resets the expander…
    component.latest(); // …so coming back re-clamps
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="vn-dialog-expand"]')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('caps the parsed chatVnProps list at 16 ids (a hostile pref cannot flood the stage)', async () => {
    const junk = Array.from({ length: 16 }, (_, i) => `vn_prop_junk_${i}`).join(',');
    // The real prop sits PAST the 16-id parse cap, so it must be ignored.
    setPrefs({ chatVnProps: `${junk},vn_prop_lamp` });
    await render();
    expect(el().querySelector('[data-testid="vn-stage-prop-vn_prop_lamp"]')).toBeNull();
    expect(component.stageProps().length).toBe(0);
  });

  it('caps the sprite cards at 8, always keeping the current speaker on stage', async () => {
    const extras = Array.from({ length: 11 }, (_, i) => makeAccount(`x${i}`, `Extra${i}`));
    // The latest message's author (alice, via s3) is NOT among the first 8 accounts.
    mastodon.getContext.and.resolveTo({ ancestors: [], descendants: [s3] });
    await render(makeConversation({ accounts: extras, last_status: s2 }));
    const sprites = el().querySelectorAll('[data-testid="vn-sprites"] .vn-sprite');
    expect(sprites.length).toBe(8);
    expect(el().querySelector('[data-testid="vn-sprite-a1"]'))
      .withContext('the current speaker is swapped onto the stage')
      .not.toBeNull();
  });

  it('renders at most 4 media polaroids even if a non-conforming server sends more', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `pm${i}`,
      type: 'image' as const,
      url: `full${i}.png`,
      preview_url: `p${i}.png`,
      remote_url: null,
      description: null,
      blurhash: null,
      meta: null,
    }));
    mastodon.getContext.and.resolveTo({ ancestors: [], descendants: [] });
    await render(
      makeConversation({
        last_status: makeStatus('m6', bob, '2026-07-01T11:00:00.000Z', { media_attachments: many }),
      }),
    );
    expect(el().querySelectorAll('[data-testid="vn-polaroids"] .vn-polaroid').length).toBe(4);
  });

  // ── a11y contract ────────────────────────────────────────────────────────

  it('announces the current message via a persistent polite live region and position-labelled nav', async () => {
    await render();
    const liveBody = el().querySelector('.vn-dialog-body')!;
    expect(liveBody).withContext('persistent live wrapper must exist').not.toBeNull();
    expect(liveBody.getAttribute('aria-live')).toBe('polite');
    expect(el().querySelector('[data-testid="vn-prev"]')!.getAttribute('aria-label')).toBe(
      'Previous message, go to message 2 of 3',
    );
    component.prev();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="vn-next"]')!.getAttribute('aria-label')).toBe(
      'Next message, go to message 3 of 3',
    );
    expect(el().querySelector('[data-testid="vn-latest"]')!.getAttribute('aria-label')).toBe(
      'Jump to latest message, message 3 of 3',
    );
    expect(el().querySelector('[data-testid="vn-position"]')!.getAttribute('aria-label')).toBe('Message 2 of 3');
  });

  // ── picker seam ──────────────────────────────────────────────────────────

  it('toggles the scene picker with an honest aria-expanded state', async () => {
    await render();
    const toggle = el().querySelector<HTMLButtonElement>('[data-testid="vn-scene-picker-toggle"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el().querySelector('[data-testid="vn-scene-picker"]')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el().querySelector('[data-testid="vn-scene-picker"]')).not.toBeNull();
  });
});
