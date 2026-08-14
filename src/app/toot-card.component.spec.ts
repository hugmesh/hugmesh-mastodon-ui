import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TootCardComponent } from './toot-card.component';
import { MastodonService, Status } from './mastodon.service';

function makeStatus(over: Partial<Status> = {}): Status {
  return {
    id: '1',
    uri: '',
    url: null,
    created_at: new Date().toISOString(),
    edited_at: null,
    content: '<p>hello <a href="#">#cats</a></p>',
    visibility: 'public',
    sensitive: false,
    spoiler_text: '',
    language: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 3,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    account: {
      id: 'a1',
      username: 'alice',
      acct: 'alice',
      url: '',
      display_name: 'Alice',
      note: '',
      avatar: '',
      avatar_static: '',
      header: '',
      header_static: '',
      locked: false,
      bot: false,
      created_at: '',
      followers_count: 0,
      following_count: 0,
      statuses_count: 0,
      fields: [],
      emojis: [],
    },
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
  };
}

describe('TootCardComponent', () => {
  let fixture: ComponentFixture<TootCardComponent>;
  let component: TootCardComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'favourite',
      'unfavourite',
      'reblog',
      'unreblog',
      'bookmark',
      'unbookmark',
    ]);

    await TestBed.configureTestingModule({
      imports: [TootCardComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }, provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(TootCardComponent);
    component = fixture.componentInstance;
  });

  it('renders the toot content and author in the DOM', () => {
    component.status = makeStatus();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="toot-content"]')?.textContent).toContain('hello');
    expect(el.querySelector('.toot-name')?.textContent).toContain('Alice');
    expect(el.querySelector('.boost-header')).toBeNull();
  });

  it('announces the ASCII screenReaderName (not the non-ASCII display_name) in the avatar alt', () => {
    component.status = makeStatus({
      account: {
        ...makeStatus().account,
        display_name: '山田太郎',
        username: 'taro',
        avatar: 'https://cdn/a.png',
        screen_reader_name: 'Yamada Taro',
      },
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const img = el.querySelector<HTMLImageElement>('.toot-avatar img')!;
    expect(img.getAttribute('alt')).toBe('Yamada Taro avatar');
    // The VISIBLE name still shows the display_name verbatim (only the spoken
    // alt/aria substitutes the ASCII screen-reader name).
    expect(el.querySelector('.toot-name')?.textContent).toContain('山田太郎');
  });

  it('falls back to display_name then @username for the avatar alt when no screenReaderName exists', () => {
    const base = makeStatus().account;
    component.status = makeStatus({ account: { ...base, display_name: 'Alice', avatar: 'https://cdn/a.png' } });
    expect(component.accountName(component.display()!.account)).toBe('Alice');
    component.status = makeStatus({ account: { ...base, display_name: '', username: 'bob' } });
    expect(component.accountName(component.display()!.account)).toBe('bob');
  });

  it('unwraps a boost: display() renders the inner reblog, isBoost() is true', () => {
    const inner = makeStatus({ id: 'inner', content: '<p>boosted body</p>' });
    component.status = makeStatus({ id: 'wrapper', reblog: inner });
    fixture.detectChanges();
    expect(component.isBoost()).toBeTrue();
    expect(component.display()?.id).toBe('inner');
    expect((fixture.nativeElement as HTMLElement).querySelector('.boost-header')).not.toBeNull();
  });

  it('optimistically increments the favourite count before the server responds', async () => {
    const s = makeStatus({ favourited: false, favourites_count: 3 });
    component.status = s;
    let resolveFav!: (v: Status) => void;
    mastodon.favourite.and.returnValue(new Promise<Status>((r) => (resolveFav = r)));

    const pending = component.toggleFavourite(s);
    // optimistic state applied synchronously
    expect(component.display()?.favourited).toBeTrue();
    expect(component.display()?.favourites_count).toBe(4);

    resolveFav(makeStatus({ favourited: true, favourites_count: 9 }));
    await pending;
    // reconciled with the server's authoritative counts
    expect(component.display()?.favourites_count).toBe(9);
    expect(mastodon.favourite).toHaveBeenCalledWith('1');
  });

  it('rolls back the optimistic favourite when the request fails', async () => {
    const s = makeStatus({ favourited: false, favourites_count: 3 });
    component.status = s;
    mastodon.favourite.and.rejectWith(new Error('boom'));

    await component.toggleFavourite(s);

    expect(component.display()?.favourited).toBeFalse();
    expect(component.display()?.favourites_count).toBe(3);
  });

  it('emits hashtagClick (without navigating) when a # link in the content is clicked', () => {
    component.status = makeStatus();
    fixture.detectChanges();
    const emitted: string[] = [];
    component.hashtagClick.subscribe((t) => emitted.push(t));

    const anchor = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="toot-content"] a',
    ) as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(ev);

    expect(emitted).toEqual(['cats']);
    expect(ev.defaultPrevented).toBeTrue();
  });

  it('formats recent timestamps as a compact relative string', () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
    expect(component.relative(thirtySecondsAgo)).toMatch(/^\d+s$/);
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(component.relative(twoHoursAgo)).toBe('2h');
  });

  it('exposes the action buttons with aria-labels and toggle state (a11y)', () => {
    component.status = makeStatus({ favourited: true, reblogged: false, bookmarked: true });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const fav = el.querySelector('[data-testid="toot-favourite"]')!;
    const boost = el.querySelector('[data-testid="toot-boost"]')!;
    const bookmark = el.querySelector('[data-testid="toot-bookmark"]')!;
    expect(fav.getAttribute('aria-label')).toBe('Favourite');
    expect(fav.getAttribute('aria-pressed')).toBe('true');
    expect(boost.getAttribute('aria-pressed')).toBe('false');
    expect(bookmark.getAttribute('aria-pressed')).toBe('true');
  });

  it('hides the decorative emoji glyphs from assistive tech', () => {
    component.status = makeStatus();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const glyph = el.querySelector('[data-testid="toot-favourite"] [aria-hidden="true"]');
    expect(glyph).not.toBeNull();
  });

  it('gives the avatar image a descriptive alt instead of an empty one', () => {
    component.status = makeStatus({
      account: { ...makeStatus().account, avatar: 'https://x/a.png', display_name: 'Alice' },
    });
    fixture.detectChanges();
    const img = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('.toot-avatar img')!;
    expect(img.alt).toContain('Alice');
  });

  it('marks REMOTE media as AI-cloak N/A — never implying it is protected', () => {
    component.status = makeStatus({
      media_attachments: [
        {
          id: 'r1', type: 'image', url: 'https://other/full.png', preview_url: 'https://other/small.png',
          remote_url: 'https://other.instance/orig.png', description: null, blurhash: null, meta: null,
        },
      ],
    });
    fixture.detectChanges();
    const na = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="toot-cloak-na"]');
    expect(na).not.toBeNull();
    expect(na!.textContent).toContain('N/A');
  });

  it('does NOT show the N/A note for our own (local) media', () => {
    component.status = makeStatus({
      media_attachments: [
        {
          id: 'l1', type: 'image', url: 'https://ours/full.png', preview_url: 'https://ours/small.png',
          remote_url: null, description: null, blurhash: null, meta: null,
        },
      ],
    });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="toot-cloak-na"]')).toBeNull();
  });

  // ── Sensitive media / content-warning reveal ─────────────────────────────
  // Regression: sensitive-flagged media WITHOUT a spoiler text was permanently
  // unviewable — [class.sensitive] blurred it, but the only reveal control
  // rendered only when spoiler_text was set.

  describe('sensitive media and content-warning reveal', () => {
    function sensitiveOnly(): Status {
      return makeStatus({
        sensitive: true,
        spoiler_text: '',
        media_attachments: [
          {
            id: 's1', type: 'image', url: 'https://ours/full.png', preview_url: 'https://ours/small.png',
            remote_url: null, description: null, blurhash: null, meta: null,
          },
        ],
      });
    }

    it('sensitive media WITHOUT a spoiler still gets a reveal control that un-blurs it', () => {
      component.status = sensitiveOnly();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;

      const img = el.querySelector<HTMLImageElement>('.toot-media img')!;
      expect(img).withContext('sensitive-only media must render (blurred)').not.toBeNull();
      expect(img.classList.contains('sensitive')).withContext('blurred before reveal').toBeTrue();

      const toggle = el.querySelector<HTMLButtonElement>('[data-testid="toot-cw-toggle"]')!;
      expect(toggle).withContext('a reveal control MUST exist for sensitive-only media').not.toBeNull();
      expect(toggle.textContent).toContain('Show media');
      expect(el.querySelector('.cw-text')?.textContent).toContain('Sensitive content');

      toggle.click();
      fixture.detectChanges();
      expect(img.classList.contains('sensitive')).withContext('revealed after the click').toBeFalse();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.textContent).toContain('Hide media');

      toggle.click();
      fixture.detectChanges();
      expect(img.classList.contains('sensitive')).withContext('re-hidden on the second click').toBeTrue();
    });

    it('sensitive-only media never hides the (unspoilered) text content', () => {
      component.status = sensitiveOnly();
      fixture.detectChanges();
      // The sensitive flag covers MEDIA only — with no spoiler text the body
      // stays visible (Mastodon semantics), blurred media beside it.
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="toot-content"]')).not.toBeNull();
    });

    it('a spoilered status keeps the classic Show more / Show less contract', () => {
      component.status = makeStatus({ spoiler_text: 'cw here' });
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const toggle = el.querySelector<HTMLButtonElement>('[data-testid="toot-cw-toggle"]')!;
      expect(el.querySelector('[data-testid="toot-content"]')).withContext('body hidden behind the CW').toBeNull();
      expect(toggle.textContent).toContain('Show more');
      toggle.click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="toot-content"]')).not.toBeNull();
      expect(toggle.textContent).toContain('Show less');
    });

    it('renders NO toggle at all for a plain (not sensitive, no spoiler) status', () => {
      component.status = makeStatus();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="toot-cw-toggle"]')).toBeNull();
    });
  });

  describe('XSS sanitization of remote/federated toot HTML (A03 / CWE-79)', () => {
    // DENY: a hostile homeserver/remote actor controls status.content. The
    // [innerHTML] binding must run Angular's sanitizer (no bypassSecurityTrust),
    // so injected script / event-handler payloads are STRIPPED before render.
    it('strips a <script> payload in toot content so it never reaches the DOM', () => {
      component.status = makeStatus({
        content: '<p>hi</p><script>window.__xss = 1;</script>',
      });
      fixture.detectChanges();
      const content = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="toot-content"]')!;
      // The benign text survives; the <script> element does not.
      expect(content.textContent).toContain('hi');
      expect(content.querySelector('script')).toBeNull();
      expect(content.innerHTML.toLowerCase()).not.toContain('<script');
      expect((window as unknown as Record<string, unknown>)['__xss']).toBeUndefined();
    });

    it('strips an onerror= event handler injected via an <img> in toot content', () => {
      component.status = makeStatus({
        content: '<p>pic</p><img src="x" onerror="window.__xss2 = 1">',
      });
      fixture.detectChanges();
      const content = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="toot-content"]')!;
      const img = content.querySelector('img');
      // If an <img> survives at all, it must carry NO inline event handler.
      expect(img?.getAttribute('onerror') ?? null).toBeNull();
      expect(content.innerHTML.toLowerCase()).not.toContain('onerror');
      expect((window as unknown as Record<string, unknown>)['__xss2']).toBeUndefined();
    });

    it('neutralizes a javascript: href on an anchor in toot content', () => {
      component.status = makeStatus({
        content: '<p><a href="javascript:window.__xss3=1">click</a></p>',
      });
      fixture.detectChanges();
      const content = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="toot-content"]')!;
      const href = (content.querySelector('a')?.getAttribute('href') ?? '').toLowerCase();
      // Angular's sanitizer rewrites a javascript: URL to the inert `unsafe:`
      // scheme, which browsers will not execute on click. The href must NOT be a
      // live javascript: URL — i.e. either it was dropped, or it is prefixed with
      // the neutralizing `unsafe:` marker.
      expect(href.startsWith('javascript:')).toBeFalse();
      if (href.includes('javascript:')) {
        expect(href).toContain('unsafe:');
      }
    });

    // ALLOW control: legitimate Mastodon formatting markup is PRESERVED, so the
    // fix neutralizes attacks without breaking normal rich-text toots.
    it('preserves safe formatting markup (links, emphasis, lists) in toot content', () => {
      component.status = makeStatus({
        content:
          '<p>see <a href="https://example.test/x">link</a> <strong>bold</strong></p>' +
          '<ul><li>one</li></ul>',
      });
      fixture.detectChanges();
      const content = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="toot-content"]')!;
      expect(content.querySelector('a')?.getAttribute('href')).toBe('https://example.test/x');
      expect(content.querySelector('strong')?.textContent).toBe('bold');
      expect(content.querySelector('li')?.textContent).toBe('one');
    });
  });

  describe('action-bar help text (a11y)', () => {
    it('renders a SCREEN-READER-ONLY help line explaining the actions', () => {
      // Operator report 2026-08-14: a VISIBLE copy in this per-post card
      // repeated the same paragraph under every post in the feed. The sighted
      // affordance now lives ONCE at the feed level
      // (mastodon-timeline.component.html, data-testid=timeline-actions-help);
      // here it stays in the a11y tree for the per-button aria-describedby.
      component.status = makeStatus();
      fixture.detectChanges();
      const help = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '[data-testid="toot-actions-help"]',
      )!;
      expect(help).withContext('the action help must exist for aria-describedby').not.toBeNull();
      expect(help.classList).withContext('screen-reader-only: one visible copy lives on the feed').toContain('sr');
      expect(help.textContent?.toLowerCase()).toContain('boost');
      expect(help.textContent?.toLowerCase()).toContain('bookmark');
    });

    it('wires EVERY action button to the help via aria-describedby (no-sight announce)', () => {
      component.status = makeStatus();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const help = el.querySelector('[data-testid="toot-actions-help"]')!;
      const helpId = help.getAttribute('id');
      expect(helpId).withContext('the help element needs a stable id to point at').toBeTruthy();

      for (const testid of ['toot-reply', 'toot-boost', 'toot-favourite', 'toot-bookmark']) {
        const btn = el.querySelector(`[data-testid="${testid}"]`)!;
        expect(btn.getAttribute('aria-describedby'))
          .withContext(`${testid} must be described by the action help`)
          .toBe(helpId);
      }
    });

    it('gives each toot card its OWN help id so describedby never cross-links cards', () => {
      const a = TestBed.createComponent(TootCardComponent);
      a.componentInstance.status = makeStatus({ id: 'A' });
      a.detectChanges();
      const b = TestBed.createComponent(TootCardComponent);
      b.componentInstance.status = makeStatus({ id: 'B' });
      b.detectChanges();
      const idA = (a.nativeElement as HTMLElement)
        .querySelector('[data-testid="toot-actions-help"]')!
        .getAttribute('id');
      const idB = (b.nativeElement as HTMLElement)
        .querySelector('[data-testid="toot-actions-help"]')!
        .getAttribute('id');
      expect(idA).not.toBe(idB);
    });
  });
});
