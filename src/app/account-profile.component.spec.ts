import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AccountProfileComponent } from './account-profile.component';
import { MastodonService, Account, Relationship } from './mastodon.service';

function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: 'a1',
    username: 'alice',
    acct: 'alice',
    url: '',
    display_name: 'Alice',
    note: '<p>bio</p>',
    avatar: 'https://x/a.png',
    avatar_static: '',
    header: '',
    header_static: '',
    locked: false,
    bot: false,
    created_at: '',
    followers_count: 2,
    following_count: 3,
    statuses_count: 4,
    fields: [],
    emojis: [],
    ...over,
  };
}

describe('AccountProfileComponent', () => {
  let fixture: ComponentFixture<AccountProfileComponent>;
  let component: AccountProfileComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  const route = { paramMap: of({ get: (_: string) => 'alice' }) } as unknown as ActivatedRoute;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'verifyCredentials',
      'getAccount',
      'lookupAccount',
      'getRelationships',
      'accountStatuses',
      'followAccount',
      'unfollowAccount',
    ]);
    mastodon.verifyCredentials.and.resolveTo(makeAccount({ id: 'me' }));
    mastodon.lookupAccount.and.resolveTo(makeAccount());
    mastodon.getRelationships.and.resolveTo([{ following: false } as Relationship]);
    mastodon.accountStatuses.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [AccountProfileComponent],
      providers: [
        { provide: MastodonService, useValue: mastodon },
        provideRouter([]),
        // ActivatedRoute mock must come AFTER provideRouter so it wins (last-provider-wins).
        { provide: ActivatedRoute, useValue: route },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountProfileComponent);
    component = fixture.componentInstance;
  });

  async function render() {
    fixture.detectChanges(); // triggers ngOnInit -> route.paramMap.subscribe -> load()
    await fixture.whenStable();
    // flush the chained awaits inside load() (verify -> lookup -> rels -> statuses)
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the profile tabs as a WAI-ARIA tablist with one selected tab', async () => {
    await render();
    expect(el().querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = el().querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(3);
    const selected = el().querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.id).toBe('account-tab-posts');
    // the active tab is keyboard-reachable, the others are removed from the tab order
    expect((el().querySelector('#account-tab-posts') as HTMLElement).tabIndex).toBe(0);
    expect((el().querySelector('#account-tab-media') as HTMLElement).tabIndex).toBe(-1);
  });

  it('moves selection with ArrowRight / ArrowLeft (roving tablist keyboard support)', async () => {
    await render();
    const tablist = el().querySelector('[role="tablist"]')!;
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(component.tab()).toBe('replies');
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(component.tab()).toBe('media');
    // wraps back to the first tab
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(component.tab()).toBe('posts');
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(component.tab()).toBe('media');
  });

  it('exposes the follow button as an aria-pressed toggle that flips on follow', async () => {
    await render();
    const btn = el().querySelector('[data-testid="account-follow-btn"]')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    mastodon.followAccount.and.resolveTo({ following: true } as Relationship);
    await component.toggleFollow();
    fixture.detectChanges();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('switches the loaded timeline when a tab is selected', async () => {
    await render();
    mastodon.accountStatuses.calls.reset();
    component.selectTab('media');
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(mastodon.accountStatuses).toHaveBeenCalled();
    const [, params] = mastodon.accountStatuses.calls.mostRecent().args;
    expect((params as Record<string, unknown>)['only_media']).toBeTrue();
  });

  it('gives the avatar a descriptive alt text', async () => {
    await render();
    const img = el().querySelector<HTMLImageElement>('.account-avatar')!;
    expect(img.alt).toContain('Alice');
  });

  it('announces the ASCII screenReaderName (not the non-ASCII display_name) in the avatar alt', async () => {
    mastodon.lookupAccount.and.resolveTo(makeAccount({ display_name: '山田太郎', screenReaderName: 'Yamada Taro' }));
    await render();
    const img = el().querySelector<HTMLImageElement>('.account-avatar')!;
    expect(img.alt).toBe('Yamada Taro avatar');
    // The visible display name still shows the non-ASCII value verbatim.
    expect(el().querySelector('.account-display')?.textContent).toContain('山田太郎');
  });
});
