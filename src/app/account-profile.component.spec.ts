import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AccountProfileComponent } from './account-profile.component';
import { MastodonService, Account, Relationship, MastodonAccessDeniedError } from './mastodon.service';

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
  let accessDenied: WritableSignal<boolean>;

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
    accessDenied = signal(false);
    Object.assign(mastodon, { accessDenied });

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
    mastodon.lookupAccount.and.resolveTo(makeAccount({ display_name: '山田太郎', screen_reader_name: 'Yamada Taro' }));
    await render();
    const img = el().querySelector<HTMLImageElement>('.account-avatar')!;
    expect(img.alt).toBe('Yamada Taro avatar');
    // The visible display name still shows the non-ASCII value verbatim.
    expect(el().querySelector('.account-display')?.textContent).toContain('山田太郎');
  });

  it('wires the follow button to a visible, live help via aria-describedby (a11y)', async () => {
    await render();
    const btn = el().querySelector('[data-testid="account-follow-btn"]')!;
    const describedBy = btn.getAttribute('aria-describedby');
    expect(describedBy).withContext('the follow button needs aria-describedby').toBeTruthy();
    const help = el().querySelector(`#${describedBy}`)!;
    expect(help).withContext('aria-describedby must resolve to a real element').not.toBeNull();
    expect(help.classList).toContain('control-help');
    // dynamic/contextual help is announced as it changes (aria-live)
    expect(help.getAttribute('aria-live')).toBe('polite');
    expect(help.textContent?.toLowerCase()).toContain('timeline');
  });

  it('updates the follow help copy with the follow state', async () => {
    await render();
    const help = () => el().querySelector('[data-testid="account-follow-help"]')!.textContent?.toLowerCase() ?? '';
    expect(help()).toContain('follow to add'); // not following yet

    mastodon.followAccount.and.resolveTo({ following: true } as Relationship);
    await component.toggleFollow();
    fixture.detectChanges();
    expect(help()).toContain('you follow this account'); // following now
  });

  // GUI-17: for a persona without ROLE_MASTODON every BFF read is a 403. The
  // whole profile sits behind `account()`, so the page rendered NOTHING
  // (contentLen=0 on the live mesh) plus a console error from the unhandled
  // lookup rejection.
  describe('no Mastodon access (HTTP 403)', () => {
    /** Drive load() directly, so a rejection surfaces HERE instead of as an
     *  unhandled rejection inside the paramMap subscription. */
    function load(acct = 'alice'): Promise<void> {
      return (component as unknown as { load(a: string): Promise<void> }).load(acct);
    }

    it('shows the no-access state, not a blank page, when verify_credentials is refused', async () => {
      mastodon.verifyCredentials.and.resolveTo(null); // the real service on a 403
      accessDenied.set(true);
      await render(); // the real path: ngOnInit -> paramMap -> load()

      const panel = el().querySelector('[data-testid="mastodon-access-denied"]');
      expect(panel).withContext('the page must not be blank').not.toBeNull();
      expect(panel!.textContent).toContain('Your account does not have Mastodon access');
      expect(el().querySelector('[data-testid="account-profile"]')).toBeNull();
      // The lookup would only be refused too: it is not even asked.
      expect(mastodon.lookupAccount).not.toHaveBeenCalled();
      expect(mastodon.getAccount).not.toHaveBeenCalled();
    });

    it('shows the no-access state when the account lookup itself is refused', async () => {
      mastodon.verifyCredentials.and.resolveTo(null); // e.g. a 401 there, not a 403
      mastodon.lookupAccount.and.rejectWith(
        new MastodonAccessDeniedError('GET /api/v1/accounts/lookup failed: 403'),
      );
      await render(); // a 403 escaping load() would fail this spec as an unhandled rejection
      expect(el().querySelector('[data-testid="mastodon-access-denied"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="account-profile"]')).toBeNull();
      expect(component.loading()).toBeFalse();
    });

    // Scope guard: ONLY the 403 is handled. A 404 keeps its old path.
    it('leaves any other lookup failure alone (a 404 still rejects, no no-access state)', async () => {
      mastodon.lookupAccount.and.rejectWith(new Error('GET /api/v1/accounts/lookup failed: 404'));
      await expectAsync(load('nobody')).toBeRejectedWithError(/failed: 404/);
      expect(component.denied()).toBeFalse();
    });

    it('a profile that loads after a refusal clears the no-access state', async () => {
      mastodon.verifyCredentials.and.resolveTo(null);
      accessDenied.set(true);
      await render();
      expect(component.denied()).toBeTrue();

      mastodon.verifyCredentials.and.resolveTo(makeAccount({ id: 'me' }));
      accessDenied.set(false);
      await load();
      fixture.detectChanges();
      expect(component.denied()).toBeFalse();
      expect(el().querySelector('[data-testid="mastodon-access-denied"]')).toBeNull();
      expect(el().querySelector('[data-testid="account-profile"]')).not.toBeNull();
    });
  });

  describe('XSS sanitization of remote/federated profile HTML (A03 / CWE-79)', () => {
    // DENY: a hostile/remote account controls its own bio (note) and custom
    // fields. The [innerHTML] bindings must run Angular's sanitizer (no
    // bypassSecurityTrust), so injected script/handler payloads are STRIPPED.
    it('strips a <script> payload from the profile bio so it never reaches the DOM', async () => {
      mastodon.lookupAccount.and.resolveTo(
        makeAccount({ note: '<p>about me</p><script>window.__bioxss = 1;</script>' }),
      );
      await render();
      const bio = el().querySelector('[data-testid="account-bio"]')!;
      expect(bio.textContent).toContain('about me');
      expect(bio.querySelector('script')).toBeNull();
      expect(bio.innerHTML.toLowerCase()).not.toContain('<script');
      expect((window as unknown as Record<string, unknown>)['__bioxss']).toBeUndefined();
    });

    it('strips an onerror= handler injected via a custom profile field value', async () => {
      mastodon.lookupAccount.and.resolveTo(
        makeAccount({
          fields: [
            { name: 'site', value: '<img src="x" onerror="window.__fieldxss = 1">', verified_at: null },
          ],
        }),
      );
      await render();
      const html = el().innerHTML.toLowerCase();
      expect(html).not.toContain('onerror');
      expect((window as unknown as Record<string, unknown>)['__fieldxss']).toBeUndefined();
    });

    // ALLOW control: legitimate bio formatting survives the fix.
    it('preserves safe formatting markup (links, emphasis) in the profile bio', async () => {
      mastodon.lookupAccount.and.resolveTo(
        makeAccount({ note: '<p>see <a href="https://example.test/me">site</a> <em>here</em></p>' }),
      );
      await render();
      const bio = el().querySelector('[data-testid="account-bio"]')!;
      expect(bio.querySelector('a')?.getAttribute('href')).toBe('https://example.test/me');
      expect(bio.querySelector('em')?.textContent).toBe('here');
    });
  });
});
