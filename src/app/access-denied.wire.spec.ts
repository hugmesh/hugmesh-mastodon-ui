import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AccountProfileComponent } from './account-profile.component';
import { MastodonTimelineComponent } from './mastodon-timeline.component';
import { BFF_BASE_URL, MASTODON_PROXY_MODE } from './mastodon.service';

/**
 * GUI-17, at the WIRE: the real MastodonService and the real stream service,
 * with `fetch` answering every `/bff/user/mastodon/**` call the way the
 * user-bff-api does for a persona without ROLE_MASTODON — HTTP 403.
 *
 * Observed on the live mesh (2026-11-11 GUI retest, e2e-user / e2e-mod /
 * e2e-admin / e2e-superadmin): /social/mastodon said "Nothing here yet" and
 * re-polled every 30s, and /social/mastodon/account/:acct rendered an EMPTY
 * host element with only `GET /api/v1/accounts/lookup failed: 403` in the
 * console.
 *
 * Deliberately uses no API the fix introduced (only routes, providers and
 * data-testids), so the same file runs against the pre-fix code and fails
 * there for the reason the live page was wrong.
 */

const DENIED_TEXT = 'Your account does not have Mastodon access';

/** Every Mastodon proxy call is refused; anything else is simply absent. */
function refusingFetch(): jasmine.Spy {
  return spyOn(globalThis, 'fetch').and.callFake((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const status = url.includes('/bff/user/mastodon') ? 403 : 404;
    return Promise.resolve(new Response(status === 403 ? 'Access Denied' : '', { status }));
  });
}

function callsTo(fetchSpy: jasmine.Spy, fragment: string): number {
  return fetchSpy.calls.allArgs().filter(([input]) => String(input).includes(fragment)).length;
}

describe('GUI-17 wire: a persona without Mastodon access (every proxy call is HTTP 403)', () => {
  describe('/social/mastodon/account/:acct', () => {
    let fixture: ComponentFixture<AccountProfileComponent>;
    let fetchSpy: jasmine.Spy;

    beforeEach(async () => {
      fetchSpy = refusingFetch();
      await TestBed.configureTestingModule({
        imports: [AccountProfileComponent],
        providers: [
          { provide: BFF_BASE_URL, useValue: '' },
          { provide: MASTODON_PROXY_MODE, useValue: true },
          provideRouter([]),
          {
            provide: ActivatedRoute,
            useValue: { paramMap: of(convertToParamMap({ acct: 'e2e_usera' })), snapshot: {} },
          },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(AccountProfileComponent);
    });

    it('renders the no-access state instead of a blank page, with no console error', async () => {
      const consoleError = spyOn(console, 'error');
      fixture.detectChanges(); // ngOnInit -> paramMap -> load()
      await fixture.whenStable();
      for (let i = 0; i < 10; i++) await Promise.resolve();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent?.trim().length)
        .withContext('the page rendered blank (contentLen=0 on the live mesh)')
        .toBeGreaterThan(0);
      const panel = host.querySelector('[data-testid="mastodon-access-denied"]');
      expect(panel).withContext('no no-access state').not.toBeNull();
      expect(panel?.textContent).toContain(DENIED_TEXT);
      expect(consoleError).not.toHaveBeenCalled();
      expect(callsTo(fetchSpy, '/api/v1/accounts/lookup'))
        .withContext('looked the account up after verify_credentials was already refused')
        .toBe(0);
    });
  });

  describe('/social/mastodon (Home timeline, wide viewport with the companion column)', () => {
    let fetchSpy: jasmine.Spy;

    beforeEach(async () => {
      fetchSpy = refusingFetch();
      // Wide enough for the companion notifications column, which polls too.
      spyOn(window, 'matchMedia').and.returnValue({
        matches: true, media: '', onchange: null,
        addEventListener: () => undefined, removeEventListener: () => undefined,
        addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
      } as unknown as MediaQueryList);
      await TestBed.configureTestingModule({
        imports: [MastodonTimelineComponent],
        providers: [
          { provide: BFF_BASE_URL, useValue: '' },
          { provide: MASTODON_PROXY_MODE, useValue: true },
          provideRouter([]),
          {
            provide: ActivatedRoute,
            useValue: { snapshot: { data: { source: 'home' }, paramMap: convertToParamMap({}) }, parent: null },
          },
        ],
      }).compileComponents();
    });

    it('says the account has no access, and stops asking: no stream, no 30s poll', fakeAsync(() => {
      const fixture = TestBed.createComponent(MastodonTimelineComponent);
      fixture.detectChanges(); // ngOnInit + effects
      tick();
      fixture.detectChanges();
      tick();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const panel = host.querySelector('[data-testid="mastodon-access-denied"]');
      expect(panel).withContext('showed an ordinary empty feed instead').not.toBeNull();
      expect(panel?.textContent).toContain(DENIED_TEXT);
      expect(host.querySelector('[data-testid="timeline-empty"]'))
        .withContext('"Nothing here yet" reads as an empty feed, not a refusal')
        .toBeNull();

      const homeBefore = callsTo(fetchSpy, '/api/v1/timelines/home');
      const notificationsBefore = callsTo(fetchSpy, '/api/v1/notifications');
      tick(30_000 * 3);
      fixture.detectChanges();

      expect(callsTo(fetchSpy, '/api/v1/timelines/home'))
        .withContext('kept polling the home timeline after a 403')
        .toBe(homeBefore);
      expect(callsTo(fetchSpy, '/api/v1/notifications'))
        .withContext('the companion kept polling notifications after a 403')
        .toBe(notificationsBefore);
      expect(callsTo(fetchSpy, '/api/v1/streaming'))
        .withContext('opened the live stream for a refused account')
        .toBe(0);

      fixture.destroy();
      discardPeriodicTasks();
      flush();
    }));
  });
});
