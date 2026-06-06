import { Component, Input, OnInit, OnChanges, SimpleChanges, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MastodonService, Status } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { ComposeBoxComponent } from './compose-box.component';

export type TimelineSource =
  | 'home'
  | 'community'
  | 'public'
  | 'hashtag'
  | 'list'
  | 'favourites'
  | 'bookmarks';

/**
 * Standalone Mastodon timeline component. Federated into the snapdragon.systems
 * host and rendered at /social/mastodon for logged-in users.
 *
 * Reused as the column shell across home / local / public / hashtag / list /
 * favourites / bookmarks via the `source` @Input (the route data sets it). The
 * Home variant shows the top ComposeBox.
 *
 * Preserves the data-testids the E2E depends on:
 *   mastodon-view, mastodon-timeline, mastodon-input, mastodon-post.
 */
@Component({
  selector: 'snap-mastodon-timeline',
  standalone: true,
  imports: [CommonModule, TootCardComponent, ComposeBoxComponent],
  templateUrl: './mastodon-timeline.component.html',
  styleUrl: './mastodon-timeline.component.scss',
})
export class MastodonTimelineComponent implements OnInit, OnChanges {
  private readonly mastodon = inject(MastodonService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  @Input() source: TimelineSource = 'home';
  /** Route param for hashtag (tags/:tag) / list (lists/:id) variants. */
  @Input() sourceParam: string | null = null;

  readonly toots = signal<Status[]>([]);
  readonly loading = signal(false);
  private readonly exhausted = signal(false);
  /** Link-header cursor for favourites/bookmarks; max_id from last item otherwise. */
  private nextMaxId: string | null = null;
  private readonly seenIds = new Set<string>();

  async ngOnInit(): Promise<void> {
    // Allow route data / params to drive the source when used via the router.
    const data = this.route.snapshot.data;
    if (data['source']) this.source = data['source'] as TimelineSource;
    const params = this.route.snapshot.paramMap;
    this.sourceParam = params.get('tag') ?? params.get('id') ?? this.sourceParam;
    await this.reload();
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if ((changes['source'] && !changes['source'].firstChange) || (changes['sourceParam'] && !changes['sourceParam'].firstChange)) {
      await this.reload();
    }
  }

  title(): string {
    switch (this.source) {
      case 'home':
        return 'Home';
      case 'community':
        return 'Local';
      case 'public':
        return 'Federated';
      case 'hashtag':
        return `#${this.sourceParam ?? ''}`;
      case 'list':
        return 'List';
      case 'favourites':
        return 'Favourites';
      case 'bookmarks':
        return 'Bookmarks';
      default:
        return 'Mastodon';
    }
  }

  canLoadMore(): boolean {
    return !this.exhausted();
  }

  trackId = (_: number, s: Status): string => s.id;

  private async fetchPage(maxId?: string): Promise<Status[]> {
    const params = maxId ? { max_id: maxId, limit: 20 } : { limit: 20 };
    switch (this.source) {
      case 'home':
        return this.mastodon.homeTimeline(params);
      case 'community':
        return this.mastodon.communityTimeline(params);
      case 'public':
        return this.mastodon.publicTimeline(params);
      case 'hashtag':
        return this.mastodon.hashtagTimeline(this.sourceParam ?? '', params);
      case 'list':
        return this.mastodon.listTimeline(this.sourceParam ?? '', params);
      case 'favourites': {
        const page = await this.mastodon.favouritesPage(maxId ? { max_id: maxId, limit: 20 } : { limit: 20 });
        this.nextMaxId = page.nextMaxId;
        return page.statuses;
      }
      case 'bookmarks': {
        const page = await this.mastodon.bookmarksPage(maxId ? { max_id: maxId, limit: 20 } : { limit: 20 });
        this.nextMaxId = page.nextMaxId;
        return page.statuses;
      }
      default:
        return [];
    }
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.exhausted.set(false);
    this.nextMaxId = null;
    this.seenIds.clear();
    try {
      const page = await this.fetchPage();
      const deduped = this.dedupe(page);
      this.toots.set(deduped);
      this.advanceCursor(page, deduped.length);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.loading() || this.exhausted()) return;
    this.loading.set(true);
    try {
      const maxId = this.usesLinkHeader() ? this.nextMaxId ?? undefined : this.lastId();
      if (this.usesLinkHeader() && !maxId) {
        this.exhausted.set(true);
        return;
      }
      const page = await this.fetchPage(maxId);
      const deduped = this.dedupe(page);
      this.toots.set([...this.toots(), ...deduped]);
      this.advanceCursor(page, deduped.length);
    } finally {
      this.loading.set(false);
    }
  }

  private usesLinkHeader(): boolean {
    return this.source === 'favourites' || this.source === 'bookmarks';
  }

  private lastId(): string | undefined {
    const list = this.toots();
    return list.length ? list[list.length - 1].id : undefined;
  }

  private advanceCursor(page: Status[], addedCount: number): void {
    if (this.usesLinkHeader()) {
      if (!this.nextMaxId) this.exhausted.set(true);
    } else if (page.length === 0 || addedCount === 0) {
      this.exhausted.set(true);
    }
  }

  /** De-dupe reblog wrappers and already-seen ids. */
  private dedupe(page: Status[]): Status[] {
    const out: Status[] = [];
    for (const s of page) {
      const key = s.reblog ? s.reblog.id : s.id;
      if (this.seenIds.has(key)) continue;
      this.seenIds.add(key);
      out.push(s);
    }
    return out;
  }

  /** Prepend a freshly posted toot (optimistic) so the E2E sees it immediately. */
  onPosted(status: Status): void {
    const key = status.reblog ? status.reblog.id : status.id;
    if (!this.seenIds.has(key)) {
      this.seenIds.add(key);
      this.toots.set([status, ...this.toots()]);
    }
  }

  goToStatus(s: Status): void {
    const target = s.reblog ? s.reblog : s;
    void this.router.navigate(['/status', target.id]);
  }

  goToHashtag(tag: string): void {
    void this.router.navigate(['/tags', tag]);
  }
}
