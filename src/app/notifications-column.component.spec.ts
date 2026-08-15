import { ComponentFixture, TestBed } from '@angular/core/testing';
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
});
