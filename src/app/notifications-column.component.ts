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
  template: `
    <section class="notifications-column" data-testid="notifications-column">
      <header class="column-head">
        <h2>Notifications</h2>
        <button type="button" data-testid="notifications-clear" (click)="clearAll()">Clear all</button>
      </header>

      <nav class="filters" data-testid="notifications-filter">
        <button
          type="button"
          *ngFor="let f of filters; let i = index"
          class="filter-chip"
          [class.active]="activeFilter() === i"
          (click)="selectFilter(i)"
        >
          {{ f.label }}
        </button>
      </nav>

      <p *ngIf="loading() && !items().length" class="loading">Loading…</p>
      <p *ngIf="!loading() && !items().length" class="empty">No notifications.</p>

      <div class="notification-list">
        <div
          class="notification-item"
          data-testid="notification-item"
          *ngFor="let n of items(); trackBy: trackId"
          [attr.data-type]="n.type"
        >
          <div class="notification-head">
            <span class="verb">{{ verb(n) }}</span>
            <a class="actor" [routerLink]="['/account', n.account.acct]">{{
              n.account.display_name || n.account.username
            }}</a>
            <button type="button" data-testid="notification-dismiss" (click)="dismiss(n.id)">✕</button>
          </div>
          <snap-mastodon-toot-card *ngIf="n.status" [status]="n.status"></snap-mastodon-toot-card>
        </div>

        <button
          *ngIf="items().length && !exhausted()"
          type="button"
          class="load-more"
          (click)="loadMore()"
          [disabled]="loading()"
        >
          {{ loading() ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </section>
  `,
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
