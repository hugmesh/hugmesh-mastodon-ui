import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { StatusDetailComponent } from './status-detail.component';
import { MastodonService, Status, Context } from './mastodon.service';

function makeStatus(id: string): Status {
  return {
    id,
    uri: '',
    url: null,
    created_at: new Date().toISOString(),
    edited_at: null,
    content: `<p>status ${id}</p>`,
    visibility: 'public',
    sensitive: false,
    spoiler_text: '',
    language: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    account: { acct: 'a', username: 'a', display_name: 'A' } as never,
    media_attachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    reblog: null,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    poll: null,
    card: null,
  } as Status;
}

describe('StatusDetailComponent', () => {
  let fixture: ComponentFixture<StatusDetailComponent>;
  let component: StatusDetailComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  const route = { paramMap: of({ get: (_: string) => '42' }) } as unknown as ActivatedRoute;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'getStatus',
      'getContext',
    ]);
    mastodon.getStatus.and.resolveTo(makeStatus('42'));
    const ctx: Context = { ancestors: [makeStatus('1')], descendants: [makeStatus('99')] };
    mastodon.getContext.and.resolveTo(ctx);

    await TestBed.configureTestingModule({
      imports: [StatusDetailComponent],
      providers: [
        { provide: MastodonService, useValue: mastodon },
        provideRouter([]),
        // ActivatedRoute mock must come AFTER provideRouter so it wins (last-provider-wins).
        { provide: ActivatedRoute, useValue: route },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusDetailComponent);
    component = fixture.componentInstance;
  });

  async function flush() {
    component.ngOnInit();
    for (let i = 0; i < 6; i++) await Promise.resolve();
  }

  it('loads the focused status and its context (ancestors + descendants) for the route id', async () => {
    await flush();
    expect(mastodon.getStatus).toHaveBeenCalledWith('42');
    expect(component.focused()?.id).toBe('42');
    expect(component.context().ancestors.map((a) => a.id)).toEqual(['1']);
    expect(component.context().descendants.map((d) => d.id)).toEqual(['99']);
  });

  it('renders ancestors / focused / descendants regions with accessible labels', async () => {
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="status-detail"]')?.getAttribute('aria-label')).toBe(
      'Conversation thread',
    );
    expect(el.querySelector('[data-testid="status-ancestors"]')?.getAttribute('aria-label')).toBe('Replied to');
    expect(el.querySelector('[data-testid="status-descendants"]')?.getAttribute('aria-label')).toBe('Replies');
    expect(el.querySelector('[data-testid="status-focused"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="status-reply-box"]')).not.toBeNull();
  });

  it('refreshes the thread context after a reply is posted', async () => {
    await flush();
    mastodon.getContext.calls.reset();
    await component.onReplyPosted();
    expect(mastodon.getContext).toHaveBeenCalledWith('42');
  });
});
