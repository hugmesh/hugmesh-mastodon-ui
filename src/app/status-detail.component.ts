import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MastodonService, Status, Context } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { ComposeBoxComponent } from './compose-box.component';

/** Mastodon Status (thread) feature: focused status with ancestors above and
 *  descendants below, plus an inline reply composer prefilled with in_reply_to_id. */
@Component({
  selector: 'snap-mastodon-status-detail',
  standalone: true,
  imports: [CommonModule, TootCardComponent, ComposeBoxComponent],
  templateUrl: './status-detail.component.html',
  styleUrl: './status-detail.component.scss',
})
export class StatusDetailComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);
  private readonly route = inject(ActivatedRoute);

  readonly focused = signal<Status | null>(null);
  readonly context = signal<Context>({ ancestors: [], descendants: [] });
  readonly loading = signal(false);

  private statusId = '';

  trackId = (_: number, s: Status): string => s.id;

  async ngOnInit(): Promise<void> {
    this.route.paramMap.subscribe(async (p) => {
      const id = p.get('id');
      if (id) {
        this.statusId = id;
        await this.load();
      }
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [status, ctx] = await Promise.all([
        this.mastodon.getStatus(this.statusId),
        this.mastodon.getContext(this.statusId),
      ]);
      this.focused.set(status);
      this.context.set(ctx);
    } finally {
      this.loading.set(false);
    }
  }

  async onReplyPosted(): Promise<void> {
    // refresh thread to show the new reply among descendants
    const ctx = await this.mastodon.getContext(this.statusId);
    this.context.set(ctx);
  }
}
