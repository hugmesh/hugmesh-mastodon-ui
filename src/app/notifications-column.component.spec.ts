import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotificationsColumnComponent } from './notifications-column.component';
import { MastodonService, Notification } from './mastodon.service';

function makeNotification(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    type: 'favourite',
    created_at: new Date().toISOString(),
    account: { acct: 'bob', username: 'bob', display_name: 'Bob' } as never,
    status: null,
    ...over,
  };
}

describe('NotificationsColumnComponent', () => {
  let fixture: ComponentFixture<NotificationsColumnComponent>;
  let component: NotificationsColumnComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'notifications',
      'dismissNotification',
      'clearNotifications',
    ]);
    mastodon.notifications.and.resolveTo([makeNotification()]);

    await TestBed.configureTestingModule({
      imports: [NotificationsColumnComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }, provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationsColumnComponent);
    component = fixture.componentInstance;
  });

  // Every spec here drives ngOnInit by hand, which now also starts the
  // background refresh timer. Tear it down explicitly or each spec leaks a
  // live interval into the ones after it. Idempotent, so specs that already
  // destroyed the component are unaffected.
  afterEach(() => component.ngOnDestroy());

  async function render() {
    await component.ngOnInit();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('reflects the active filter on the chip via aria-pressed', async () => {
    await render();
    const chips = el().querySelectorAll('.filter-chip');
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    expect(chips[1].getAttribute('aria-pressed')).toBe('false');

    component.selectFilter(1);
    fixture.detectChanges();
    expect(chips[0].getAttribute('aria-pressed')).toBe('false');
    expect(chips[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('passes the selected filter type through to the service query', async () => {
    await render();
    component.selectFilter(1); // Mentions
    await fixture.whenStable();
    const [params] = mastodon.notifications.calls.mostRecent().args;
    expect((params as Record<string, unknown>)['types']).toEqual(['mention']);
  });

  it('labels each dismiss button so screen readers know what it dismisses', async () => {
    await render();
    const dismiss = el().querySelector('[data-testid="notification-dismiss"]')!;
    expect(dismiss.getAttribute('aria-label')).toContain('Bob');
  });

  it('announces the ASCII screenReaderName (not the non-ASCII display_name) in the dismiss label', async () => {
    mastodon.notifications.and.resolveTo([
      makeNotification({
        account: { acct: 'taro', username: 'taro', display_name: '山田太郎', screen_reader_name: 'Yamada Taro' } as never,
      }),
    ]);
    await render();
    const dismiss = el().querySelector('[data-testid="notification-dismiss"]')!;
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss notification from Yamada Taro');
    // The visible actor link still shows the display_name verbatim.
    expect(el().querySelector('.actor')?.textContent).toContain('山田太郎');
  });

  it('renders notifications in a semantic list', async () => {
    await render();
    expect(el().querySelector('ul.notification-list')).not.toBeNull();
    expect(el().querySelector('li.notification-item')).not.toBeNull();
  });

  it('removes a notification from the list when dismissed', async () => {
    await render();
    mastodon.dismissNotification.and.resolveTo();
    await component.dismiss('n1');
    expect(component.items().length).toBe(0);
  });

  it('warns that Clear-all is permanent via a visible help wired with aria-describedby', async () => {
    await render();
    const clear = el().querySelector('[data-testid="notifications-clear"]')!;
    const describedBy = clear.getAttribute('aria-describedby');
    expect(describedBy).withContext('Clear all needs aria-describedby').toBeTruthy();
    const help = el().querySelector(`#${describedBy}`)!;
    expect(help).withContext('aria-describedby must resolve to a real element').not.toBeNull();
    expect(help.classList).toContain('control-help');
    expect(help.textContent?.toLowerCase()).toContain('cannot be undone');
  });

  it('lays the Clear-all help on its OWN row, so the heading and button keep their width', async () => {
    // The head is a flex row holding three children: the heading, the Clear-all
    // button, and the button's `.control-help`. `.control-help` is display:block
    // because the platform puts help UNDER its control — but a block child of a
    // flex container is still a flex ITEM, so it shared the row and took roughly a
    // third of it. The two short children lost: "Notifications" rendered as
    // "Noti/ficat/ions" and the button as "Cl/ea/r all", a vertical sliver of
    // letters, on an otherwise wide desktop column.
    //
    // Asserted as GEOMETRY rather than as a CSS declaration: `flex-basis: 100%` is
    // the current fix, but the thing that must stay true is that the help sits
    // below the button and the button is wide enough to read. A test naming the
    // declaration would pass for any future refactor that kept the property and
    // broke the layout.
    await render();
    const host = el() as HTMLElement;
    host.style.width = '640px';           // a desktop-width column, deterministic
    await fixture.whenStable();

    const clear = host.querySelector('[data-testid="notifications-clear"]') as HTMLElement;
    const help = host.querySelector('[data-testid="notifications-clear-help"]') as HTMLElement;

    expect(help.offsetTop)
      .withContext('the help must start BELOW the button, not beside it')
      .toBeGreaterThanOrEqual(clear.offsetTop + clear.offsetHeight);

    // "Clear all" on one line: comfortably wider than it is tall. When it collapsed
    // into a sliver the button was TALLER than it was wide.
    expect(clear.offsetWidth)
      .withContext('Clear all collapsed into a vertical sliver')
      .toBeGreaterThan(clear.offsetHeight);
  });
  describe('background refresh', () => {
    // The gap this closes: the column used to fetch once on mount and then only
    // ever on an explicit filter switch / load-more / dismiss / clear-all, so a
    // mention that landed while the user sat on the page was invisible until
    // they navigated away and back.

    it('re-fetches on its own timer with no user action at all, cursored ABOVE the newest item', fakeAsync(() => {
      void component.ngOnInit();
      tick();
      expect(mastodon.notifications).toHaveBeenCalledTimes(1);

      mastodon.notifications.calls.reset();
      mastodon.notifications.and.resolveTo([]);
      tick(30_000);

      expect(mastodon.notifications)
        .withContext('the column never refreshed itself')
        .toHaveBeenCalledTimes(1);
      const [params] = mastodon.notifications.calls.mostRecent().args as [Record<string, unknown>];
      // min_id, not since_id: since_id returns the NEWEST page and would splice
      // a hole into the list once more than one page arrived between ticks.
      expect(params['min_id']).toBe('n1');
      expect(params['max_id']).toBeUndefined();

      component.ngOnDestroy();
      discardPeriodicTasks();
    }));

    it('prepends only genuinely new notifications, keeping the pages already loaded', fakeAsync(() => {
      mastodon.notifications.and.resolveTo([
        makeNotification({ id: 'n3' }),
        makeNotification({ id: 'n2' }),
        makeNotification({ id: 'n1' }),
      ]);
      void component.ngOnInit();
      tick();
      expect(component.items().map((n) => n.id)).toEqual(['n3', 'n2', 'n1']);

      // The refresh answers with one new item and one the column already holds.
      mastodon.notifications.and.resolveTo([makeNotification({ id: 'n4' }), makeNotification({ id: 'n3' })]);
      tick(30_000);

      expect(component.items().map((n) => n.id))
        .withContext('a refresh must not duplicate or discard what is on screen')
        .toEqual(['n4', 'n3', 'n2', 'n1']);

      component.ngOnDestroy();
      discardPeriodicTasks();
    }));

    it('never flips the column to busy for a background refresh', fakeAsync(() => {
      void component.ngOnInit();
      tick();

      let busyDuringFetch = false;
      mastodon.notifications.calls.reset();
      mastodon.notifications.and.callFake(async () => {
        busyDuringFetch = busyDuringFetch || component.loading();
        return [];
      });
      tick(30_000);

      // Guard against passing vacuously: a refresh has to have actually run.
      expect(mastodon.notifications).toHaveBeenCalledTimes(1);

      // A background fetch that sets `loading` would disable the Load-more
      // button and flip the list to aria-busy under a reading user every 30s.
      expect(busyDuringFetch).withContext('a background refresh set loading').toBeFalse();
      expect(component.loading()).toBeFalse();

      component.ngOnDestroy();
      discardPeriodicTasks();
    }));

    it('leaves the visible list intact when a refresh fails, and keeps refreshing after', fakeAsync(() => {
      void component.ngOnInit();
      tick();
      expect(component.items().map((n) => n.id)).toEqual(['n1']);

      mastodon.notifications.and.rejectWith(new Error('network down'));
      tick(30_000);
      expect(component.items().map((n) => n.id))
        .withContext('a failed refresh emptied the column')
        .toEqual(['n1']);

      mastodon.notifications.and.resolveTo([makeNotification({ id: 'n2' })]);
      tick(30_000);
      expect(component.items().map((n) => n.id))
        .withContext('one failure stopped the timer for good')
        .toEqual(['n2', 'n1']);

      component.ngOnDestroy();
      discardPeriodicTasks();
    }));

    it('spends no requests while the tab is hidden, and refreshes the moment it comes back', fakeAsync(() => {
      void component.ngOnInit();
      tick();
      mastodon.notifications.calls.reset();

      const hidden = spyOnProperty(Document.prototype, 'hidden', 'get').and.returnValue(true);
      tick(90_000); // three whole ticks go by in a background tab
      expect(mastodon.notifications)
        .withContext('an abandoned background tab kept spending BFF requests')
        .not.toHaveBeenCalled();

      hidden.and.returnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));
      tick();
      expect(mastodon.notifications)
        .withContext('coming back to the tab did not refresh')
        .toHaveBeenCalledTimes(1);

      component.ngOnDestroy();
      discardPeriodicTasks();
    }));

    it('stops refreshing once the column is destroyed', fakeAsync(() => {
      void component.ngOnInit();
      tick();
      component.ngOnDestroy();

      mastodon.notifications.calls.reset();
      tick(120_000);
      expect(mastodon.notifications)
        .withContext('the timer outlived the component')
        .not.toHaveBeenCalled();

      // Nothing left to discard: a leaked periodic task would fail fakeAsync here.
    }));

    // The other ordering of the same teardown, and the one `ngOnDestroy` alone
    // cannot reach: `ngOnInit` awaits the initial load BEFORE it installs the
    // timer and the listener, so a component destroyed during that await tears
    // down nothing (there is nothing yet) and the continuation then installs
    // both behind it. A user clicking another route link before a mesh BFF
    // answers is entirely ordinary, and every such mount would leave a
    // permanent 30s poll and a strong reference to a dead component behind for
    // the life of the federated shell page.
    it('starts no timer when destroyed WHILE the initial load is still in flight', fakeAsync(() => {
      void component.ngOnInit(); // the initial reload() is out
      component.ngOnDestroy(); // route change before it comes back
      tick(); // the awaited continuation resumes HERE, after teardown

      mastodon.notifications.calls.reset();
      tick(120_000); // four whole poll periods
      expect(mastodon.notifications)
        .withContext('a timer installed after ngOnDestroy outlived the component')
        .not.toHaveBeenCalled();

      discardPeriodicTasks();
    }));

    it('leaves no visibilitychange listener when destroyed WHILE the initial load is in flight', fakeAsync(() => {
      void component.ngOnInit();
      component.ngOnDestroy();
      tick();

      mastodon.notifications.calls.reset();
      document.dispatchEvent(new Event('visibilitychange'));
      tick();
      expect(mastodon.notifications)
        .withContext('a document listener installed after ngOnDestroy outlived the component')
        .not.toHaveBeenCalled();

      discardPeriodicTasks();
    }));

    // The post-flight bail, both halves. A refresh takes a round trip, and the
    // list it was cursored against can be gone by the time it answers.
    it('discards a refresh whose answer arrives after the user switched filters', fakeAsync(() => {
      void component.ngOnInit();
      tick();
      expect(component.items().map((n) => n.id)).toEqual(['n1']);

      let resolvePoll!: (v: Notification[]) => void;
      mastodon.notifications.calls.reset(); // the initial load is already counted
      mastodon.notifications.and.returnValue(
        new Promise<Notification[]>((r) => (resolvePoll = r)),
      );
      tick(30_000); // the background refresh is now in flight
      expect(mastodon.notifications).toHaveBeenCalledTimes(1);

      // The user picks another chip while that answer is still out; its own
      // reload has already put the new filter's list on screen.
      component.activeFilter.set(1);
      component.items.set([makeNotification({ id: 'm1' })]);

      resolvePoll([makeNotification({ id: 'n9' })]);
      tick();

      expect(component.items().map((n) => n.id))
        .withContext("a refresh for the OLD filter was spliced into the NEW filter's list")
        .toEqual(['m1']);

      component.ngOnDestroy();
      discardPeriodicTasks();
    }));

    it('discards a refresh whose answer arrives after the user started their own fetch', fakeAsync(() => {
      void component.ngOnInit();
      tick();

      let resolvePoll!: (v: Notification[]) => void;
      mastodon.notifications.calls.reset(); // the initial load is already counted
      mastodon.notifications.and.returnValue(
        new Promise<Notification[]>((r) => (resolvePoll = r)),
      );
      tick(30_000);
      expect(mastodon.notifications).toHaveBeenCalledTimes(1);

      // A user-driven fetch (load-more, dismiss, clear) started mid-flight: it
      // owns the list now, and the background answer must not race it.
      component.loading.set(true);

      resolvePoll([makeNotification({ id: 'n9' })]);
      tick();

      expect(component.items().map((n) => n.id))
        .withContext('a background refresh raced the fetch the user asked for')
        .toEqual(['n1']);

      component.loading.set(false);
      component.ngOnDestroy();
      discardPeriodicTasks();
    }));

    it('adopts the whole page when the column is cold, and clears the exhausted flag', fakeAsync(() => {
      mastodon.notifications.and.resolveTo([]);
      void component.ngOnInit();
      tick();
      expect(component.items()).toEqual([]);
      expect(component.exhausted())
        .withContext('an empty first load must mark the column exhausted')
        .toBeTrue();

      mastodon.notifications.and.resolveTo([makeNotification({ id: 'n5' })]);
      tick(30_000);

      // No top item to count up from, so no cursor: the page is adopted whole
      // with reload()'s own semantics rather than prepended against nothing.
      const [params] = mastodon.notifications.calls.mostRecent().args as [Record<string, unknown>];
      expect(params['min_id']).toBeUndefined();

      expect(component.items().map((n) => n.id))
        .withContext('a cold column never picked up the first notification to arrive')
        .toEqual(['n5']);
      expect(component.exhausted())
        .withContext('the column stayed marked exhausted after items arrived')
        .toBeFalse();

      component.ngOnDestroy();
      discardPeriodicTasks();
    }));
  });
});
