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
  templateUrl: './poll.component.html',
  styleUrl: './poll.component.scss',
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
