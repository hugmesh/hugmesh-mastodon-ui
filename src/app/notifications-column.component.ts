import { Component, OnInit, signal, inject } from '@angular/core';

import { RouterLink } from '@angular/router';
import { MastodonService, Notification, Account } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { accessibleName } from './accessible-name';

interface FilterChip {
  label: string;
  types?: string[];
  exclude_types?: string[];
}

/** Mastodon Notifications column: grouped by type with type filter chips,
 *  embedded TootCard for status-bearing types, follow rows, dismiss + clear. */
@Component({
  selector: 'hug-mastodon-notifications-column',
  standalone: true,
  imports: [RouterLink, TootCardComponent],
  templateUrl: './notifications-column.component.html',
  styleUrl: './notifications-column.component.scss',
})
export class NotificationsColumnComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);

  readonly items = signal<Notification[]>([]);
  readonly loading = signal(false);
  readonly activeFilter = signal(0);
  readonly exhausted = signal(false);

  readonly filters: FilterChip[] = [
    { label: 'All' },
    { label: 'Mentions', types: ['mention'] },
    { label: 'Boosts', types: ['reblog'] },
    { label: 'Favourites', types: ['favourite'] },
    { label: 'Follows', types: ['follow', 'follow_request'] },
  ];

  /**
   * Track-by for the notification list.
   *
   * @param _ - Unused list index.
   * @param n - The notification item.
   * @returns The notification's string id.
   */
  trackId = (_: number, n: Notification): string => n.id;

  /** Load the initial notification page on view init.
   *
   *  TODO: no auto-refresh — this only re-fetches on an explicit filter
   *  switch/load-more/dismiss/clear-all (see reload() below), never on an
   *  interval or a push. A user has to leave and re-enter this route (or
   *  manually switch filters) to see a new mention/boost/favourite/follow
   *  land. The platform SSE stream (see README Roadmap) never carries these
   *  Mastodon-native types, so this needs either a plain polling interval or
   *  Mastodon/Akkoma's native WebSocket streaming API (`/api/v1/streaming`). */
  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  /**
   * Accessible name for a notification actor. Returns the ASCII
   * `screenReaderName` when supplied, else `display_name`, else `@username`.
   * Feeds the actor's dismiss `aria-label` so non-ASCII names are announced
   * via their ASCII counterpart; the visible link still shows `display_name`.
   *
   * @param a - The actor account.
   * @returns A pronounceable, ASCII-safe name string.
   */
  accountName(a: Account): string {
    return accessibleName(a.display_name || a.username, a.screen_reader_name);
  }

  /**
   * Human-readable verb describing what the notification actor did.
   *
   * @param n - The notification to describe.
   * @returns A short verb phrase (e.g. `"boosted your post"`).
   */
  verb(n: Notification): string {
    switch (n.type) {
      case 'mention':
        return '💬 mentioned you';
      case 'reblog':
        return '🔁 boosted your post';
      case 'favourite':
        return '⭐ favourited your post';
      case 'follow':
        return '➕ followed you';
      case 'follow_request':
        return '➕ requested to follow you';
      case 'poll':
        return '📊 a poll ended';
      case 'status':
        return '🔔 posted';
      case 'update':
        return '✏️ edited a post';
      default:
        return n.type;
    }
  }

  /**
   * Switch the active filter chip and reload.
   * No-ops when the filter is already selected.
   *
   * @param i - Index into the `filters` array.
   */
  selectFilter(i: number): void {
    if (this.activeFilter() === i) return;
    this.activeFilter.set(i);
    void this.reload();
  }

  /**
   * Build the API params for the current filter chip and an optional cursor.
   *
   * @param maxId - Optional `max_id` cursor for pagination.
   * @returns A params record suitable for `MastodonService.notifications`.
   */
  private filterParams(maxId?: string): Record<string, unknown> {
    const f = this.filters[this.activeFilter()];
    const params: Record<string, unknown> = { limit: 30 };
    if (f.types) params['types'] = f.types;
    if (f.exclude_types) params['exclude_types'] = f.exclude_types;
    if (maxId) params['max_id'] = maxId;
    return params;
  }

  /**
   * Reload from the first page of the active filter.
   * Calls GET /api/v1/notifications with the current filter params.
   */
  async reload(): Promise<void> {
    this.loading.set(true);
    this.exhausted.set(false);
    try {
      const list = await this.mastodon.notifications(this.filterParams());
      this.items.set(list);
      if (!list.length) this.exhausted.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Append the next page of notifications using the last item's id as cursor.
   */
  async loadMore(): Promise<void> {
    if (this.loading() || this.exhausted()) return;
    const last = this.items()[this.items().length - 1];
    if (!last) return;
    this.loading.set(true);
    try {
      const more = await this.mastodon.notifications(this.filterParams(last.id));
      if (!more.length) {
        this.exhausted.set(true);
      } else {
        this.items.set([...this.items(), ...more]);
      }
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Dismiss a single notification and remove it from the local list.
   * Calls POST /api/v1/notifications/{id}/dismiss.
   *
   * @param id - The notification id to dismiss.
   */
  async dismiss(id: string): Promise<void> {
    await this.mastodon.dismissNotification(id);
    // Remove immediately from the local list so the UI updates without a reload.
    this.items.set(this.items().filter((n) => n.id !== id));
  }

  /**
   * Clear ALL notifications server-side and empty the local list.
   * Calls POST /api/v1/notifications/clear.
   */
  async clearAll(): Promise<void> {
    await this.mastodon.clearNotifications();
    this.items.set([]);
    this.exhausted.set(true);
  }
}
