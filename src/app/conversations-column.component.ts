import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MastodonService, Conversation } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { ComposeBoxComponent } from './compose-box.component';
import { VnChatViewComponent } from './vn/vn-chat-view.component';

/** Mastodon DirectTimeline / Conversations: rows of participants + last_status,
 *  with an inline direct-visibility reply composer. Each conversation can be
 *  swapped in place into the visual-novel presentation (snap-mastodon-vn-chat)
 *  via its per-conversation "VN mode" toggle. */
@Component({
  selector: 'snap-mastodon-conversations-column',
  standalone: true,
  imports: [CommonModule, TootCardComponent, ComposeBoxComponent, VnChatViewComponent],
  templateUrl: './conversations-column.component.html',
  styleUrl: './conversations-column.component.scss',
})
export class ConversationsColumnComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);

  readonly items = signal<Conversation[]>([]);
  readonly loading = signal(false);
  readonly exhausted = signal(false);
  readonly replyingTo = signal<string | null>(null);
  /** Conversation ids currently presented in VN mode (per-conversation, keyed
   *  by id so a list reload keeps the mode on the same conversation). */
  readonly vnMode = signal<ReadonlySet<string>>(new Set<string>());

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

  isVn(id: string): boolean {
    return this.vnMode().has(id);
  }

  /** Swap one conversation between the classic row and the VN presentation.
   *  Entering VN mode closes the row's inline reply — the VN view carries its
   *  own reply seam, so two composers for one conversation would be confusing. */
  toggleVn(id: string): void {
    const next = new Set(this.vnMode());
    if (!next.delete(id)) next.add(id);
    this.vnMode.set(next);
    if (next.has(id) && this.replyingTo() === id) this.replyingTo.set(null);
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
