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
});
