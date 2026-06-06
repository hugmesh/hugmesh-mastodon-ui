import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MastodonService, Conversation } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { ComposeBoxComponent } from './compose-box.component';

/** Mastodon DirectTimeline / Conversations: rows of participants + last_status,
 *  with an inline direct-visibility reply composer. */
@Component({
  selector: 'snap-mastodon-conversations-column',
  standalone: true,
  imports: [CommonModule, TootCardComponent, ComposeBoxComponent],
  templateUrl: './conversations-column.component.html',
  styleUrl: './conversations-column.component.scss',
})
export class ConversationsColumnComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);

  readonly items = signal<Conversation[]>([]);
  readonly loading = signal(false);
  readonly exhausted = signal(false);
  readonly replyingTo = signal<string | null>(null);

  trackId = (_: number, c: Conversation): string => c.id;

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  participantNames(c: Conversation): string {
    return c.accounts.map((a) => a.display_name || a.username).join(', ') || 'You';
  }

  toggleReply(id: string): void {
    this.replyingTo.set(this.replyingTo() === id ? null : id);
  }

  async onReplied(): Promise<void> {
    this.replyingTo.set(null);
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.exhausted.set(false);
    try {
      const list = await this.mastodon.conversations({ limit: 20 });
      this.items.set(list);
      if (!list.length) this.exhausted.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.loading() || this.exhausted()) return;
    const last = this.items()[this.items().length - 1];
    if (!last) return;
    this.loading.set(true);
    try {
      const more = await this.mastodon.conversations({ max_id: last.id, limit: 20 });
      if (!more.length) {
        this.exhausted.set(true);
      } else {
        this.items.set([...this.items(), ...more]);
      }
    } finally {
      this.loading.set(false);
    }
  }
}
