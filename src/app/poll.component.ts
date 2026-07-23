import { Component, EventEmitter, Input, Output, inject, signal, computed } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MastodonService, Poll } from './mastodon.service';

/** Mastodon Poll component: renders options with vote bars + percentages,
 *  allows single/multiple selection before voting, then shows results. */
@Component({
  selector: 'hug-mastodon-poll',
  standalone: true,
  imports: [FormsModule],
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

  /**
   * Whether to show result bars rather than the voting controls.
   * True when the poll has expired or the viewer has already voted.
   *
   * @returns `true` if the results view should be shown.
   */
  showResults(): boolean {
    const p = this._poll();
    return !!p && (p.expired || !!p.voted);
  }

  /**
   * The integer percentage for one poll option's vote bar (0–100).
   *
   * @param p - The poll entity.
   * @param votes - The raw vote count for this option (may be `null` when hidden).
   * @returns A rounded percentage, or `0` when the total or count is unknown.
   */
  percent(p: Poll, votes: number | null): number {
    if (!p.votes_count || votes == null) return 0;
    return Math.round((votes / p.votes_count) * 100);
  }

  /**
   * A human-readable time-remaining label for the poll expiry.
   *
   * @param p - The poll entity.
   * @returns A string like `'3h left'`, `'Closed'`, or `'Open'`.
   */
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

  /**
   * Select a single option by index (for single-choice polls).
   * Replaces any prior selection.
   *
   * @param i - The option index to select.
   */
  pick(i: number): void {
    this.selected.set([i]);
  }

  /**
   * Toggle one option in/out of the selection (for multi-choice polls).
   *
   * @param i - The option index to toggle.
   */
  toggle(i: number): void {
    const cur = this.selected();
    this.selected.set(cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]);
  }

  /**
   * Submit the current selection to POST /api/v1/polls/{id}/votes.
   * Emits the updated poll via `pollChange` so the parent TootCard signal
   * can reflect the new vote counts immediately.
   */
  async vote(): Promise<void> {
    const p = this._poll();
    if (!p || this.selected().length === 0) return;
    this.voting.set(true);
    try {
      const updated = await this.mastodon.voteOnPoll(p.id, this.selected());
      this._poll.set(updated);
      // Emit the updated poll so the parent toot-card can update its own signal.
      this.pollChange.emit(updated);
    } finally {
      this.voting.set(false);
    }
  }
}
