import { Component, EventEmitter, Input, Output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MastodonService, Poll } from './mastodon.service';

/** Mastodon Poll component: renders options with vote bars + percentages,
 *  allows single/multiple selection before voting, then shows results. */
@Component({
  selector: 'snap-mastodon-poll',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="poll" data-testid="poll" *ngIf="current() as p">
      <ng-container *ngIf="showResults(); else voteForm">
        <div
          class="poll-option poll-result"
          data-testid="poll-option"
          *ngFor="let opt of p.options; let i = index"
          [class.own]="(p.own_votes || []).includes(i)"
        >
          <div class="poll-bar" [style.width.%]="percent(p, opt.votes_count)"></div>
          <span class="poll-label">{{ opt.title }}</span>
          <span class="poll-pct">{{ percent(p, opt.votes_count) }}%</span>
        </div>
        <div class="poll-meta" data-testid="poll-results">
          {{ p.votes_count }} vote{{ p.votes_count === 1 ? '' : 's' }} ·
          <span>{{ p.expired ? 'Closed' : timeLeft(p) }}</span>
        </div>
      </ng-container>

      <ng-template #voteForm>
        <label
          class="poll-option"
          data-testid="poll-option"
          *ngFor="let opt of p.options; let i = index"
        >
          <input
            *ngIf="p.multiple"
            type="checkbox"
            [checked]="selected().includes(i)"
            (change)="toggle(i)"
          />
          <input
            *ngIf="!p.multiple"
            type="radio"
            name="poll-{{ p.id }}"
            [checked]="selected().includes(i)"
            (change)="pick(i)"
          />
          <span class="poll-label">{{ opt.title }}</span>
        </label>
        <button
          type="button"
          data-testid="poll-vote"
          (click)="vote()"
          [disabled]="selected().length === 0 || voting()"
        >
          Vote
        </button>
        <div class="poll-meta">
          {{ p.votes_count }} vote{{ p.votes_count === 1 ? '' : 's' }} ·
          <span>{{ timeLeft(p) }}</span>
        </div>
      </ng-template>
    </div>
  `,
})
export class PollComponent {
  private readonly mastodon = inject(MastodonService);

  private readonly _poll = signal<Poll | null>(null);
  @Input({ required: true }) set poll(value: Poll) {
    this._poll.set(value);
  }
  @Output() readonly pollChange = new EventEmitter<Poll>();

  readonly current = computed(() => this._poll());
  readonly selected = signal<number[]>([]);
  readonly voting = signal(false);

  showResults(): boolean {
    const p = this._poll();
    return !!p && (p.expired || !!p.voted);
  }

  percent(p: Poll, votes: number | null): number {
    if (!p.votes_count || votes == null) return 0;
    return Math.round((votes / p.votes_count) * 100);
  }

  timeLeft(p: Poll): string {
    if (!p.expires_at) return 'Open';
    const ms = new Date(p.expires_at).getTime() - Date.now();
    if (ms <= 0) return 'Closed';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m left`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h left`;
    return `${Math.round(hrs / 24)}d left`;
  }

  pick(i: number): void {
    this.selected.set([i]);
  }

  toggle(i: number): void {
    const cur = this.selected();
    this.selected.set(cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]);
  }

  async vote(): Promise<void> {
    const p = this._poll();
    if (!p || this.selected().length === 0) return;
    this.voting.set(true);
    try {
      const updated = await this.mastodon.voteOnPoll(p.id, this.selected());
      this._poll.set(updated);
      this.pollChange.emit(updated);
    } finally {
      this.voting.set(false);
    }
  }
}
