import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MastodonTimelineComponent } from './mastodon-timeline.component';
import { MastodonService, Status } from './mastodon.service';
import { MastodonStreamService, StreamStatus } from './mastodon-stream.service';
import { PreferencesService } from './preferences.service';

function status(id: string, reblogId?: string): Status {
  const base = {
    uri: '',
    url: null,
    created_at: new Date().toISOString(),
    edited_at: null,
    content: '',
    visibility: 'public' as const,
    sensitive: false,
    spoiler_text: '',
    language: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    account: { acct: 'x', username: 'x', display_name: 'X' } as never,
    media_attachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    reblog: null,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    poll: null,
    card: null,
  };
  const s = { ...base, id } as Status;
  if (reblogId) s.reblog = { ...base, id: reblogId } as Status;
  return s;
}

describe('MastodonTimelineComponent', () => {
  let fixture: ComponentFixture<MastodonTimelineComponent>;
  let component: MastodonTimelineComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;
  let router: jasmine.SpyObj<Router>;

  const route = {
    snapshot: { data: {}, paramMap: { get: (_: string) => null } },
  } as unknown as ActivatedRoute;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'homeTimeline',
      'communityTimeline',
      'publicTimeline',
      'hashtagTimeline',
      'favouritesPage',
    ]);
    mastodon.homeTimeline.and.resolveTo([]);
    mastodon.communityTimeline.and.resolveTo([]);
    mastodon.publicTimeline.and.resolveTo([]);
    Object.assign(mastodon, { accessDenied: signal(false) });
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [MastodonTimelineComponent],
      providers: [
        { provide: MastodonService, useValue: mastodon },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MastodonTimelineComponent);
    component = fixture.componentInstance;
  });

  /** Operator report 2026-08-14: the action-bar help paragraph rendered under
   *  EVERY post (it lived in the per-post card). It now renders ONCE for the
   *  feed; the cards keep a screen-reader-only copy for aria-describedby. */
  it('renders the action-bar help ONCE for the whole feed, not per post', async () => {
    const toot = (id: string) => ({
      id, created_at: new Date().toISOString(), content: `<p>post ${id}</p>`,
      account: { id: 'a', username: 'u', acct: 'u', display_name: 'U', url: '',
                 note: '', avatar: '', avatar_static: '', header: '', header_static: '',
                 locked: false, bot: false, created_at: '', followers_count: 0,
                 following_count: 0, statuses_count: 0, fields: [], emojis: [] },
      replies_count: 0, reblogs_count: 0, favourites_count: 0,
      visibility: 'public', media_attachments: [], mentions: [], tags: [],
      emojis: [], spoiler_text: '', sensitive: false, url: null, uri: '',
      in_reply_to_id: null, in_reply_to_account_id: null, reblog: null,
      favourited: false, reblogged: false, bookmarked: false, poll: null,
    }) as any;
    mastodon.homeTimeline.and.resolveTo([toot('1'), toot('2'), toot('3')]);
    component.source = 'home';
    await component.ngOnInit();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid="timeline-actions-help"]').length).toBe(1);
    // every per-card copy is screen-reader-only (kept for aria-describedby)
    const cardHelps = el.querySelectorAll('[data-testid="toot-actions-help"]');
    for (const h of Array.from(cardHelps)) {
      expect(h.classList).toContain('sr');
    }
  });

  it('derives a human title for each source', () => {
    component.source = 'home';
    expect(component.title()).toBe('Home');
    component.source = 'community';
    expect(component.title()).toBe('Local');
    component.source = 'public';
    expect(component.title()).toBe('Federated');
    component.source = 'hashtag';
    component.sourceParam = 'cats';
    expect(component.title()).toBe('#cats');
    component.source = 'favourites';
    expect(component.title()).toBe('Favourites');
  });

  it('calls homeTimeline for the home source on reload', async () => {
    component.source = 'home';
    mastodon.homeTimeline.and.resolveTo([status('1'), status('2')]);
    await component.reload();
    expect(mastodon.homeTimeline).toHaveBeenCalled();
    expect(component.toots().map((t) => t.id)).toEqual(['1', '2']);
  });

  it('routes the community source to communityTimeline (local feed)', async () => {
    component.source = 'community';
    mastodon.communityTimeline.and.resolveTo([status('9')]);
    await component.reload();
    expect(mastodon.communityTimeline).toHaveBeenCalled();
    expect(mastodon.homeTimeline).not.toHaveBeenCalled();
  });

  it('de-duplicates reblog wrappers and already-seen ids across pages', async () => {
    // first page: a plain status and a boost of id "100"
    mastodon.homeTimeline.and.resolveTo([status('1'), status('w1', '100')]);
    component.source = 'home';
    await component.reload();
    expect(component.toots().map((t) => t.id)).toEqual(['1', 'w1']);

    // second page: a re-boost of the same "100" (dup) plus a fresh "2"
    mastodon.homeTimeline.and.resolveTo([status('w2', '100'), status('2')]);
    await component.loadMore();
    // the duplicate boost of 100 is dropped; only "2" is appended
    expect(component.toots().map((t) => t.id)).toEqual(['1', 'w1', '2']);
  });

  it('optimistically prepends a freshly posted toot and ignores a duplicate post', () => {
    component.onPosted(status('new'));
    expect(component.toots().map((t) => t.id)).toEqual(['new']);
    component.onPosted(status('new'));
    expect(component.toots().length).toBe(1);
  });

  it('navigates to the underlying status (unwrapping boosts) on reply', () => {
    component.goToStatus(status('wrap', '500'));
    // MOUNT-RELATIVE (a5dc1ff): the command list is RELATIVE and carries
    // relativeTo = this remote's mount. The old absolute ['/status', id] was the
    // shell-bounce defect, and this spec was never updated with the code — it
    // has been red on main since. An absolute path here would regress it.
    expect(router.navigate).toHaveBeenCalledWith(
      ['status', '500'], jasmine.objectContaining({ relativeTo: jasmine.anything() }));
    const [commands] = router.navigate.calls.mostRecent().args as [unknown[]];
    expect((commands[0] as string).startsWith('/')).toBeFalse();
  });

  // ── Saved-appearance re-apply (regression) ────────────────────────────────
  // PreferencesService stamps data-mastodon-* on the remote ROOTS in its own
  // constructor — which runs before this column's view exists. Nothing
  // re-applied afterwards, so a saved appearance did not reach the column on a
  // fresh load (visibly: a saved theme did not survive a reload; under the
  // federated host mount, where no hug-mastodon-root wrapper exists, it never
  // applied at all). ngAfterViewInit re-applies once the view is in the DOM.
  it('re-applies the saved appearance to the column once its view exists', async () => {
    const prefs = TestBed.inject(PreferencesService);
    prefs.hydrate({ theme: 'mono', font: 'serif' });

    // A FRESH component: its column element exists from the create pass but has
    // NOT been through change detection / lifecycle hooks yet, so the service's
    // bootstrap-time apply() has provably never seen it (the negative control —
    // this is exactly the state a real page load leaves it in).
    const fresh = TestBed.createComponent(MastodonTimelineComponent);
    fresh.componentInstance.source = 'home';
    const column = () =>
      (fresh.nativeElement as HTMLElement).querySelector('[data-testid="mastodon-view"]')!;
    expect(column().getAttribute('data-mastodon-theme'))
      .withContext('unstamped before the lifecycle runs')
      .toBeNull();

    fresh.detectChanges(); // runs change detection, then fires ngAfterViewInit

    expect(column().getAttribute('data-mastodon-theme')).toBe('mono');
    expect(column().getAttribute('data-mastodon-font')).toBe('serif');
  });

  it('exposes the timeline as an accessible feed labelled by its heading (a11y)', async () => {
    component.source = 'home';
    mastodon.homeTimeline.and.resolveTo([]);
    await component.reload();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const view = el.querySelector('[data-testid="mastodon-view"]')!;
    expect(view.getAttribute('aria-labelledby')).toBe('timeline-heading');
    expect(el.querySelector('#timeline-heading')).not.toBeNull();
    expect(el.querySelector('[data-testid="mastodon-timeline"]')?.getAttribute('role')).toBe('feed');
  });
});

// ---------------------------------------------------------------------------
// GUI-17: a persona WITHOUT ROLE_MASTODON gets HTTP 403 on every BFF call. The
// column rendered "Nothing here yet" and kept a 30s poll knocking on the gate.
// ---------------------------------------------------------------------------

/** Stand-in for the root stream singleton: the status is set by hand, and
 *  start/stop are spies, so a spec can prove the stream was never opened. */
class FakeStream {
  readonly status = signal<StreamStatus>('idle');
  readonly reason = signal('');
  readonly updates = signal<Status[]>([]);
  readonly deletions = signal<string[]>([]);
  readonly start = jasmine.createSpy('start');
  readonly stop = jasmine.createSpy('stop');
}

describe('MastodonTimelineComponent (no Mastodon access, HTTP 403)', () => {
  let mastodon: jasmine.SpyObj<MastodonService>;
  let denied: ReturnType<typeof signal<boolean>>;
  let stream: FakeStream;

  const route = {
    snapshot: { data: {}, paramMap: { get: (_: string) => null } },
  } as unknown as ActivatedRoute;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'homeTimeline', 'communityTimeline', 'notifications',
    ]);
    // What the real service does on a 403 read: the fallback [] AND the record.
    mastodon.homeTimeline.and.resolveTo([]);
    mastodon.communityTimeline.and.resolveTo([]);
    mastodon.notifications.and.resolveTo([]);
    denied = signal(true);
    Object.assign(mastodon, { accessDenied: denied });
    stream = new FakeStream();
    // The column's children (appearance panel, client-connect banner) start
    // their own real BFF fetch chains on construction. Answer them here, so
    // none of those chains is still in flight when this spec ends and lands
    // inside a LATER spec that replaced fetch (jasmine runs in random order).
    spyOn(globalThis, 'fetch').and.callFake(() => Promise.resolve(new Response(null, { status: 404 })));

    await TestBed.configureTestingModule({
      imports: [MastodonTimelineComponent],
      providers: [
        { provide: MastodonService, useValue: mastodon },
        { provide: MastodonStreamService, useValue: stream },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) },
      ],
    }).compileComponents();
  });

  function create(source: 'home' | 'community' = 'home'): ComponentFixture<MastodonTimelineComponent> {
    const fixture = TestBed.createComponent(MastodonTimelineComponent);
    fixture.componentInstance.source = source;
    return fixture;
  }

  const q = (f: ComponentFixture<unknown>, sel: string) => (f.nativeElement as HTMLElement).querySelector(sel);

  it('says the account has no Mastodon access instead of "Nothing here yet"', async () => {
    const fixture = create();
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    const panel = q(fixture, '[data-testid="mastodon-access-denied"]');
    expect(panel).withContext('the no-access state must render').not.toBeNull();
    expect(panel!.textContent).toContain('Your account does not have Mastodon access');
    expect(panel!.getAttribute('role')).toBe('status');
    expect(q(fixture, '[data-testid="timeline-empty"]')).withContext('not the empty-feed line').toBeNull();
    // Nothing that would only be refused again: no composer, no live-state line.
    expect(q(fixture, 'hug-mastodon-compose-box')).toBeNull();
    expect(q(fixture, '[data-testid="live-state"]')).toBeNull();
    fixture.componentInstance.ngOnDestroy();
  });

  it('never opens the live stream for a refused account', async () => {
    const fixture = create();
    await fixture.componentInstance.ngOnInit();
    expect(stream.start).not.toHaveBeenCalled();
    fixture.componentInstance.ngOnDestroy();
  });

  // The stream singleton's `unsupported` is STICKY, so a fresh column sees it
  // before its own first read answers and starts the degraded poll. Once the
  // read says 403, that poll must stop: every tick would be the same refusal.
  it('stops the 30s poll once the read is refused, even with the stream already "unsupported"', fakeAsync(() => {
    stream.status.set('unsupported');
    const fixture = create();
    fixture.detectChanges(); // ngOnInit + the polling effect
    tick();
    fixture.detectChanges();
    expect(mastodon.homeTimeline).toHaveBeenCalledTimes(1);

    tick(30_000 * 3);
    fixture.detectChanges();
    expect(mastodon.homeTimeline).withContext('no poll after a 403').toHaveBeenCalledTimes(1);
    fixture.componentInstance.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // NEGATIVE CONTROL: an empty page that was NOT a 403 (a 500 degrades to []
  // too) is still an empty feed, and the degraded poll still runs.
  it('keeps the empty-feed line and the poll for an empty page that was not a 403', fakeAsync(() => {
    denied.set(false);
    stream.status.set('unsupported');
    const fixture = create();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(q(fixture, '[data-testid="mastodon-access-denied"]')).toBeNull();
    expect(q(fixture, '[data-testid="timeline-empty"]')).not.toBeNull();

    tick(30_000 * 3);
    expect(mastodon.homeTimeline).toHaveBeenCalledTimes(4);
    fixture.componentInstance.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('a page WITH posts proves access, whatever a concurrent read recorded', async () => {
    mastodon.homeTimeline.and.resolveTo([status('1')]);
    const fixture = create();
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    expect(fixture.componentInstance.denied()).toBeFalse();
    expect(q(fixture, '[data-testid="mastodon-access-denied"]')).toBeNull();
    expect(fixture.componentInstance.toots().length).toBe(1);
    fixture.componentInstance.ngOnDestroy();
  });

  it('applies to every feed source, not just Home (Local here)', async () => {
    const fixture = create('community');
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    expect(q(fixture, '[data-testid="mastodon-access-denied"]')).not.toBeNull();
    fixture.componentInstance.ngOnDestroy();
  });

  // Wide viewport: the companion notifications column reads the same gated
  // BFF; it must not stay mounted (and polling) beside the refusal.
  it('drops the companion notifications column when refused on a wide viewport', async () => {
    spyOn(window, 'matchMedia').and.returnValue({
      matches: true, media: '', onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    } as unknown as MediaQueryList);
    denied.set(false);
    const fixture = create();
    fixture.detectChanges();
    expect(q(fixture, '[data-testid="deck-companion"]')).withContext('wide + not refused: shown').not.toBeNull();

    denied.set(true);
    await fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(q(fixture, '[data-testid="deck-companion"]')).withContext('refused: dropped').toBeNull();
    expect((fixture.nativeElement as HTMLElement).classList).toContain('no-companion');
    fixture.componentInstance.ngOnDestroy();
  });
});
