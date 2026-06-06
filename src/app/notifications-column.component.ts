import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MastodonService, Notification } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';

interface FilterChip {
  label: string;
  types?: string[];
  exclude_types?: string[];
}

/** Mastodon Notifications column: grouped by type with type filter chips,
 *  embedded TootCard for status-bearing types, follow rows, dismiss + clear. */
@Component({
  selector: 'snap-mastodon-notifications-column',
  standalone: true,
  imports: [CommonModule, RouterLink, TootCardComponent],
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

  trackId = (_: number, n: Notification): string => n.id;

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

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

  selectFilter(i: number): void {
    if (this.activeFilter() === i) return;
    this.activeFilter.set(i);
    void this.reload();
  }

  private filterParams(maxId?: string): Record<string, unknown> {
    const f = this.filters[this.activeFilter()];
    const params: Record<string, unknown> = { limit: 30 };
    if (f.types) params['types'] = f.types;
    if (f.exclude_types) params['exclude_types'] = f.exclude_types;
    if (maxId) params['max_id'] = maxId;
    return params;
  }

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

  async dismiss(id: string): Promise<void> {
    await this.mastodon.dismissNotification(id);
    this.items.set(this.items().filter((n) => n.id !== id));
  }

  async clearAll(): Promise<void> {
    await this.mastodon.clearNotifications();
    this.items.set([]);
    this.exhausted.set(true);
  }
}
