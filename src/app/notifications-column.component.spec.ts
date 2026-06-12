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
});
