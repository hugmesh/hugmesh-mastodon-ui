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
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', ['conversations', 'getContext']);
    mastodon.conversations.and.resolveTo([makeConversation({ unread: true })]);
    // The VN view (entered via the per-conversation toggle) walks the thread
    // through the status context endpoint; fail-soft empty keeps tests hermetic.
    mastodon.getContext.and.resolveTo({ ancestors: [], descendants: [] });

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

  it('the per-conversation VN mode toggle swaps the row to the visual-novel view and back', async () => {
    await render();
    const toggle = el().querySelector<HTMLButtonElement>('[data-testid="conversation-vn-toggle"]')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(el().querySelector('hug-mastodon-vn-chat')).toBeNull();
    expect(el().querySelector('hug-mastodon-toot-card')).not.toBeNull();

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(el().querySelector('hug-mastodon-vn-chat')).withContext('VN view swapped in').not.toBeNull();
    expect(el().querySelector('hug-mastodon-toot-card')).withContext('classic row swapped out').toBeNull();
    expect(el().querySelector('[data-testid="conversation-reply-toggle"]'))
      .withContext('the row reply toggle yields to the VN reply seam')
      .toBeNull();

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(el().querySelector('hug-mastodon-vn-chat')).toBeNull();
    expect(el().querySelector('hug-mastodon-toot-card')).not.toBeNull();
  });

  it('entering VN mode closes an open inline reply for that conversation', async () => {
    await render();
    component.toggleReply('c1');
    fixture.detectChanges();
    expect(component.replyingTo()).toBe('c1');

    component.toggleVn('c1');
    expect(component.replyingTo()).withContext('VN mode owns the reply seam').toBeNull();
    expect(component.isVn('c1')).toBeTrue();

    component.toggleVn('c1');
    expect(component.isVn('c1')).toBeFalse();
  });
});
