import { Component, NgZone, OnDestroy, OnInit, signal, inject } from '@angular/core';

import { RouterLink } from '@angular/router';
import { MastodonService, Notification, Account } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { accessibleName } from './accessible-name';
import { mountRoute } from './mount-route';

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
export class NotificationsColumnComponent implements OnInit, OnDestroy {
  /** Background refresh cadence. Deliberately the same 30s as
   *  {@link MastodonTimelineComponent}'s degraded poll, so the two columns that
   *  sit side by side on a wide viewport tick together instead of interleaving
   *  two different rhythms of BFF traffic. */
  private static readonly POLL_MS = 30_000;

  /** Page size for every notifications fetch — the initial load, "Load more",
   *  and each background tick. */
  private static readonly PAGE_LIMIT = 30;

  /** This remote's mount point — every in-app link resolves against it
   *  (see mount-route.ts: absolute links bounce out of the remote). */
  readonly mount = mountRoute();
  private readonly mastodon = inject(MastodonService);
  private readonly zone = inject(NgZone);

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

  /** Timer handle for the background refresh, `null` when not polling. */
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Load the initial notification page, then keep it fresh on a timer.
   *
   * WHY A TIMER RATHER THAN A PUSH. {@link MastodonStreamService} already
   * speaks the homeserver's native streaming API and its `user` stream does
   * carry `notification` frames — but that service deliberately dispatches only
   * `update`/`delete`, so nothing surfaces notifications from it today, and it
   * is a root singleton whose `start()`/`stop()` lifecycle is owned by
   * {@link MastodonTimelineComponent}. Copying the timeline's pattern here
   * (poll only while the stream reports `unsupported`) would therefore leave
   * this column refreshing NEVER on exactly the deployments where the stream is
   * up. So this polls unconditionally: a guaranteed floor that is correct on
   * every deployment. Making the shared stream surface `notification` frames —
   * and giving it a refcounted lifecycle so a second consumer cannot stop it
   * out from under the feed — is a separate change to that service.
   */
  async ngOnInit(): Promise<void> {
    await this.reload();
    this.startPolling();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /** Property, not method, so add/removeEventListener share one reference. */
  private readonly onVisibilityChange = (): void => {
    // Returning to the tab is the moment the user most wants current data, and
    // it is also the tick (or ticks) the hidden-tab guard just skipped.
    if (!this.tabHidden()) void this.pollOnce();
  };

  /** True when this document is in a background tab. Refreshing a hidden tab
   *  spends BFF requests nobody is reading, and every abandoned tab would keep
   *  spending them for as long as the browser stays open. */
  private tabHidden(): boolean {
    return typeof document !== 'undefined' && document.hidden;
  }

  /**
   * Start the background refresh. Idempotent.
   *
   * The interval is registered OUTSIDE the Angular zone deliberately. A
   * repeating timer inside it is a permanently-pending macrotask, so
   * `ApplicationRef.isStable` never becomes true again and everything that
   * waits on stability waits forever — `fixture.whenStable()` in a spec, the
   * router's initial-navigation gate, SSR/hydration stability. (Measured, not
   * assumed: registering it in-zone hung this component's own suite until the
   * karma browser was killed on a ping timeout.) Each tick then re-enters the
   * zone via `zone.run`, so the fetch and the signal writes it makes are
   * ordinary in-zone work and change detection behaves normally.
   */
  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.zone.runOutsideAngular(() => {
      this.pollTimer = setInterval(() => {
        if (this.tabHidden()) return;
        this.zone.run(() => void this.pollOnce());
      }, NotificationsColumnComponent.POLL_MS);
    });
  }

  private stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /**
   * One background refresh.
   *
   * Deliberately NOT `reload()`. A full reload throws away every page the user
   * pulled in with "Load more" and would yank the list back to page one under
   * them every 30 seconds. This asks only for what is NEWER than the top item
   * and prepends it, so their scroll depth survives. It also never touches
   * `loading`, because a background fetch must not disable the Load-more button
   * or flip the list to `aria-busy` while the user is reading it.
   *
   * `min_id` (not `since_id`) is the cursor on purpose: `min_id` returns the
   * window immediately ABOVE what we already hold, so a prepend is always
   * contiguous, whereas `since_id` returns the NEWEST page and would splice a
   * hole into the list whenever more than one page arrived between ticks. When
   * a full page comes back we are simply still behind, and the next tick — now
   * cursored on the newer top item — walks the rest of the way up.
   *
   * Known limitation, stated rather than hidden: because this only ever looks
   * upward, a notification the same user dismissed in ANOTHER session is not
   * reconciled away here until something triggers a real `reload()`. Mastodon's
   * own web client is prepend-only for the same reason — paying a full refetch
   * every 30 seconds to catch that costs the user their loaded pages.
   */
  private async pollOnce(): Promise<void> {
    // A user-driven fetch is already in flight; let it win.
    if (this.loading()) return;

    const filterAtStart = this.activeFilter();
    const newest = this.items()[0];

    let fresh: Notification[];
    try {
      fresh = await this.mastodon.notifications(
        newest ? this.filterParams(undefined, newest.id) : this.filterParams(),
      );
    } catch {
      // A failed background refresh must not break the column the user is
      // reading, and must not stop the timer — the next tick tries again.
      return;
    }

    // The user switched filters, or started their own fetch, while we were in
    // flight: this answer belongs to a list that is no longer on screen.
    if (this.activeFilter() !== filterAtStart || this.loading()) return;

    if (!newest) {
      // Cold column (nothing loaded, or just cleared): there is no cursor to
      // count up from, so adopt the page whole with reload()'s own semantics.
      this.items.set(fresh);
      this.exhausted.set(!fresh.length);
      return;
    }

    // De-duped against what is already shown: a retry, or a notification the
    // user's own action already put in the list, must not appear twice.
    const known = new Set(this.items().map((n) => n.id));
    const added = fresh.filter((n) => !known.has(n.id));
    if (added.length) this.items.set([...added, ...this.items()]);
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
   * @param maxId - Optional `max_id` cursor, to page DOWN into older items.
   * @param minId - Optional `min_id` cursor, to page UP into newer items (the
   *   background refresh; see {@link pollOnce} for why not `since_id`).
   * @returns A params record suitable for `MastodonService.notifications`.
   */
  private filterParams(maxId?: string, minId?: string): Record<string, unknown> {
    const f = this.filters[this.activeFilter()];
    const params: Record<string, unknown> = { limit: NotificationsColumnComponent.PAGE_LIMIT };
    if (f.types) params['types'] = f.types;
    if (f.exclude_types) params['exclude_types'] = f.exclude_types;
    if (maxId) params['max_id'] = maxId;
    if (minId) params['min_id'] = minId;
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
