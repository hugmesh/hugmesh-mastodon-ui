import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PollComponent } from './poll.component';
import { MastodonService, Poll } from './mastodon.service';

function makePoll(over: Partial<Poll> = {}): Poll {
  return {
    id: 'p1',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    expired: false,
    multiple: false,
    votes_count: 10,
    voters_count: 10,
    voted: false,
    own_votes: [],
    options: [
      { title: 'A', votes_count: 7 },
      { title: 'B', votes_count: 3 },
    ],
    emojis: [],
    ...over,
  };
}

describe('PollComponent', () => {
  let fixture: ComponentFixture<PollComponent>;
  let component: PollComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', ['voteOnPoll']);
    await TestBed.configureTestingModule({
      imports: [PollComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }],
    }).compileComponents();
    fixture = TestBed.createComponent(PollComponent);
    component = fixture.componentInstance;
  });

  it('computes the rounded percentage of total votes per option', () => {
    const p = makePoll();
    expect(component.percent(p, 7)).toBe(70);
    expect(component.percent(p, 3)).toBe(30);
    expect(component.percent(p, null)).toBe(0);
    expect(component.percent(makePoll({ votes_count: 0 }), 0)).toBe(0);
  });

  it('shows the vote form for an open, not-yet-voted poll', () => {
    component.poll = makePoll({ voted: false, expired: false });
    fixture.detectChanges();
    expect(component.showResults()).toBeFalse();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="poll-vote"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="poll-results"]')).toBeNull();
  });

  it('shows results (not the form) once the poll has been voted on or expired', () => {
    component.poll = makePoll({ voted: true });
    fixture.detectChanges();
    expect(component.showResults()).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="poll-results"]')).not.toBeNull();

    component.poll = makePoll({ voted: false, expired: true });
    fixture.detectChanges();
    expect(component.showResults()).toBeTrue();
  });

  it('single-choice pick() replaces the selection; multiple toggle() accumulates', () => {
    component.pick(0);
    expect(component.selected()).toEqual([0]);
    component.pick(1);
    expect(component.selected()).toEqual([1]);

    component.selected.set([]);
    component.toggle(0);
    component.toggle(2);
    expect(component.selected()).toEqual([0, 2]);
    component.toggle(0);
    expect(component.selected()).toEqual([2]);
  });

  it('votes via the service and emits the updated poll', async () => {
    component.poll = makePoll();
    component.pick(1);
    const updated = makePoll({ voted: true, votes_count: 11 });
    mastodon.voteOnPoll.and.resolveTo(updated);

    const emitted: Poll[] = [];
    component.pollChange.subscribe((p) => emitted.push(p));

    await component.vote();

    expect(mastodon.voteOnPoll).toHaveBeenCalledWith('p1', [1]);
    expect(emitted).toEqual([updated]);
    expect(component.current()?.voted).toBeTrue();
  });

  it('does not call the service when nothing is selected', async () => {
    component.poll = makePoll();
    component.selected.set([]);
    await component.vote();
    expect(mastodon.voteOnPoll).not.toHaveBeenCalled();
  });

  it('groups the open vote choices in a labelled fieldset (a11y)', () => {
    component.poll = makePoll({ voted: false, expired: false });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const fieldset = el.querySelector('fieldset.poll-fieldset');
    expect(fieldset).not.toBeNull();
    expect(fieldset!.querySelector('legend')).not.toBeNull();
  });

  it('hides the decorative result bar from screen readers and exposes a text equivalent', () => {
    component.poll = makePoll({ voted: true });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.poll-bar')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.poll-option .sr')?.textContent).toContain('percent');
  });
});
