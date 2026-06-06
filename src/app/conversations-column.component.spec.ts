import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ConversationsColumnComponent } from './conversations-column.component';
import { MastodonService, Conversation, Status } from './mastodon.service';

function makeStatus(): Status {
  return {
    id: 's1',
    uri: '',
    url: null,
    created_at: new Date().toISOString(),
    edited_at: null,
    content: '<p>dm</p>',
    visibility: 'direct',
    sensitive: false,
    spoiler_text: '',
    language: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    account: { acct: 'bob', username: 'bob', display_name: 'Bob' } as never,
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

function makeConversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    unread: false,
    accounts: [{ acct: 'bob', username: 'bob', display_name: 'Bob' } as never],
    last_status: makeStatus(),
    ...over,
  };
}

describe('ConversationsColumnComponent', () => {
  let fixture: ComponentFixture<ConversationsColumnComponent>;
  let component: ConversationsColumnComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', ['conversations']);
    mastodon.conversations.and.resolveTo([makeConversation({ unread: true })]);

    await TestBed.configureTestingModule({
      imports: [ConversationsColumnComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }, provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ConversationsColumnComponent);
    component = fixture.componentInstance;
  });

  async function render() {
    await component.ngOnInit();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('joins participant display names for the row label', () => {
    expect(component.participantNames(makeConversation())).toBe('Bob');
    expect(component.participantNames(makeConversation({ accounts: [] }))).toBe('You');
  });

  it('renders conversations as a semantic list with a screen-reader unread cue', async () => {
    await render();
    expect(el().querySelector('ul.conversation-list li.conversation-item')).not.toBeNull();
    // the dot itself is decorative; the textual "Unread." is what SRs announce
    expect(el().querySelector('[data-testid="conversation-unread"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(el().querySelector('.conversation-participants .sr')?.textContent).toContain('Unread');
  });

  it('toggles the inline reply composer and reflects it via aria-expanded', async () => {
    await render();
    const toggle = el().querySelector('.reply-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    component.toggleReply('c1');
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el().querySelector('.conversation-reply')).not.toBeNull();

    component.toggleReply('c1');
    expect(component.replyingTo()).toBeNull();
  });

  it('reloads and closes the composer after a reply is posted', async () => {
    await render();
    component.toggleReply('c1');
    mastodon.conversations.calls.reset();
    await component.onReplied();
    expect(component.replyingTo()).toBeNull();
    expect(mastodon.conversations).toHaveBeenCalled();
  });
});
