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

  describe('action-bar help text (a11y)', () => {
    it('renders a VISIBLE, non-empty help line explaining the actions', () => {
      component.status = makeStatus();
      fixture.detectChanges();
      const help = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '[data-testid="toot-actions-help"]',
      )!;
      expect(help).withContext('the action help must exist + be in the DOM (visible, not .sr-only)').not.toBeNull();
      expect(help.classList).toContain('control-help');
      expect(help.classList).not.toContain('sr'); // sighted users see it, not screen-reader-only
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
