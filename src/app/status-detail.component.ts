import { Component, OnInit, signal, inject } from '@angular/core';

import { ActivatedRoute } from '@angular/router';
import { MastodonService, Status, Context } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { ComposeBoxComponent } from './compose-box.component';

/** Mastodon Status (thread) feature: focused status with ancestors above and
 *  descendants below, plus an inline reply composer prefilled with in_reply_to_id. */
@Component({
  selector: 'hug-mastodon-status-detail',
  standalone: true,
  imports: [TootCardComponent, ComposeBoxComponent],
  templateUrl: './status-detail.component.html',
  styleUrl: './status-detail.component.scss',
})
export class StatusDetailComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);
  private readonly route = inject(ActivatedRoute);

  readonly focused = signal<Status | null>(null);
  readonly context = signal<Context>({ ancestors: [], descendants: [] });
  readonly loading = signal(false);

  /** The id of the focused status (from the `:id` route param). */
  private statusId = '';

  /**
   * Track-by for ancestor and descendant lists.
   *
   * @param _ - Unused list index.
   * @param s - The status item.
   * @returns The status's string id.
   */
  trackId = (_: number, s: Status): string => s.id;

  /**
   * Subscribe to the `:id` route param and load the thread on navigation.
   * Fetches the focused status and its context in parallel.
   */
  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      const id = p.get('id');
      if (id) {
        this.statusId = id;
        this.load().catch((err: unknown) => console.error('Failed to load status thread', err));
      }
    });
  }

  /**
   * Fetch the focused status and its thread context in parallel.
   * Calls GET /api/v1/statuses/{id} and GET /api/v1/statuses/{id}/context.
   */
  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // Parallel fetch for faster thread rendering.
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

  /**
   * Refresh the thread context after the user posts a reply so the new reply
   * appears in the descendants list.
   * Calls GET /api/v1/statuses/{id}/context.
   */
  async onReplyPosted(): Promise<void> {
    const ctx = await this.mastodon.getContext(this.statusId);
    this.context.set(ctx);
  }
}
