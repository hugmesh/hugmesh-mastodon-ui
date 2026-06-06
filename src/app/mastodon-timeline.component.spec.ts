import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { MastodonTimelineComponent } from './mastodon-timeline.component';
import { MastodonService, Status } from './mastodon.service';

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
    expect(router.navigate).toHaveBeenCalledWith(['/status', '500']);
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
