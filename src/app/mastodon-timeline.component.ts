import {
  AfterViewInit,
  Component,
  Input,
  OnInit,
  OnChanges,
  SimpleChanges,
  signal,
  inject,
} from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import { MastodonService, Status } from './mastodon.service';
import { PreferencesService } from './preferences.service';
import { TootCardComponent } from './toot-card.component';
import { ComposeBoxComponent } from './compose-box.component';
import { AppearancePanelComponent } from './appearance-panel.component';

export type TimelineSource =
  | 'home'
  | 'community'
  | 'public'
  | 'hashtag'
  | 'list'
  | 'favourites'
  | 'bookmarks';

/**
 * Standalone Mastodon timeline component. Federated into the hugmesh.systems
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
  selector: 'hug-mastodon-timeline',
  standalone: true,
  imports: [TootCardComponent, ComposeBoxComponent, AppearancePanelComponent],
  templateUrl: './mastodon-timeline.component.html',
  styleUrl: './mastodon-timeline.component.scss',
})
export class MastodonTimelineComponent implements OnInit, OnChanges, AfterViewInit {
  private readonly mastodon = inject(MastodonService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly prefs = inject(PreferencesService);

  /** The timeline variant to render (set from route `data.source` or directly as an `@Input`). */
  @Input() source: TimelineSource = 'home';
  /** Secondary route param for hashtag (`tags/:tag`) and list (`lists/:id`) variants. */
  @Input() sourceParam: string | null = null;

  readonly toots = signal<Status[]>([]);
  readonly loading = signal(false);
  /** True once the current source has no more pages to load. */
  private readonly exhausted = signal(false);
  /**
   * Link-header cursor for sources that paginate via RFC5988 (`favourites`/
   * `bookmarks`). For status-id–based sources, `lastId()` is used instead.
   */
  private nextMaxId: string | null = null;
  /** Set of canonical status ids already in the list (keyed on reblog.id for boosts). */
  private readonly seenIds = new Set<string>();

  /**
   * Read route data and params on init so the timeline variant is driven by
   * the router when mounted via `MASTODON_ROUTES`, while still respecting
   * direct `@Input()` bindings when embedded in a template.
   */
  async ngOnInit(): Promise<void> {
    // Route data overrides the @Input default when the component is routed.
    const data = this.route.snapshot.data;
    if (data['source']) this.source = data['source'] as TimelineSource;
    const params = this.route.snapshot.paramMap;
    this.sourceParam = params.get('tag') ?? params.get('id') ?? this.sourceParam;
    await this.reload();
  }

  /**
   * Re-stamp the saved appearance onto this column.
   *
   * PreferencesService scopes every data-mastodon-* attribute to the remote
   * ROOT elements (`.hug-mastodon, hug-mastodon-root`) and applies them in its
   * constructor — which runs during app bootstrap, BEFORE this view exists. Its
   * own comment promises a re-apply "so roots that mount after the service does
   * (the timeline) still get the data-attributes", but nothing re-applied: on a
   * fresh load this column rendered with NO appearance attributes until the user
   * next touched a control, so a saved theme/font/density visibly did not
   * survive a reload. Under the federated host mount there is no
   * `hug-mastodon-root` wrapper to inherit from either, so the preference never
   * applied at all there. apply() is idempotent, so re-running it once the view
   * is in the DOM is the whole fix.
   */
  ngAfterViewInit(): void {
    this.prefs.apply();
  }

  /**
   * Reload when `source` or `sourceParam` changes after the initial render
   * (e.g. the user switches hashtags without a full route transition).
   *
   * @param changes - The Angular `SimpleChanges` map.
   */
  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if ((changes['source'] && !changes['source'].firstChange) || (changes['sourceParam'] && !changes['sourceParam'].firstChange)) {
      await this.reload();
    }
  }

  /**
   * A human-readable heading for the current timeline variant.
   *
   * @returns A short label like `"Home"`, `"Local"`, `"#cats"`, etc.
   */
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

  /** @returns `true` while more pages are available to load. */
  canLoadMore(): boolean {
    return !this.exhausted();
  }

  /**
   * Track-by for the toot list. Uses the status's own id.
   *
   * @param _ - Unused list index.
   * @param s - The status item.
   * @returns The status's string id.
   */
  trackId = (_: number, s: Status): string => s.id;

  /**
   * Fetch one page of statuses from the API source appropriate for the current
   * `source`. For `favourites`/`bookmarks`, also updates `nextMaxId` from the
   * RFC5988 Link response header so subsequent pages use the correct cursor.
   *
   * @param maxId - Optional cursor; omit for the first page.
   * @returns An array of {@link Status} objects for the page.
   */
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
        // Favourites paginate via Link headers — capture the next cursor.
        const page = await this.mastodon.favouritesPage(maxId ? { max_id: maxId, limit: 20 } : { limit: 20 });
        this.nextMaxId = page.nextMaxId;
        return page.statuses;
      }
      case 'bookmarks': {
        // Bookmarks paginate via Link headers — capture the next cursor.
        const page = await this.mastodon.bookmarksPage(maxId ? { max_id: maxId, limit: 20 } : { limit: 20 });
        this.nextMaxId = page.nextMaxId;
        return page.statuses;
      }
      default:
        return [];
    }
  }

  /**
   * Reload from the first page, resetting all cursor/dedupe state.
   * Called on init, source change, and explicit refresh.
   */
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

  /**
   * Append the next page of statuses. No-ops when already loading or exhausted.
   * Uses the Link-header cursor for `favourites`/`bookmarks` and the last
   * visible status id for all other sources.
   */
  async loadMore(): Promise<void> {
    if (this.loading() || this.exhausted()) return;
    this.loading.set(true);
    try {
      const maxId = this.usesLinkHeader() ? this.nextMaxId ?? undefined : this.lastId();
      if (this.usesLinkHeader() && !maxId) {
        // No Link header cursor means no further pages.
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

  /**
   * Whether the current source uses RFC5988 Link-header pagination (where status
   * ids are NOT the cursor; the Link header is the only reliable next-page token).
   *
   * @returns `true` for `favourites` and `bookmarks`.
   */
  private usesLinkHeader(): boolean {
    return this.source === 'favourites' || this.source === 'bookmarks';
  }

  /**
   * The id of the last visible status, used as the `max_id` cursor for sources
   * that paginate by status id.
   *
   * @returns The last status's id string, or `undefined` when the list is empty.
   */
  private lastId(): string | undefined {
    const list = this.toots();
    return list.length ? list[list.length - 1].id : undefined;
  }

  /**
   * Mark the source as exhausted when there are no more pages. For Link-header
   * sources, exhaustion is when `nextMaxId` is null; for id-based sources, it
   * is when the API returned nothing or de-duplication removed all items.
   *
   * @param page - The raw API page (before de-duplication).
   * @param addedCount - Number of statuses actually added after de-duplication.
   */
  private advanceCursor(page: Status[], addedCount: number): void {
    if (this.usesLinkHeader()) {
      if (!this.nextMaxId) this.exhausted.set(true);
    } else if (page.length === 0 || addedCount === 0) {
      this.exhausted.set(true);
    }
  }

  /**
   * De-duplicate statuses across pages. For boost wrappers the canonical key is
   * the inner `reblog.id` (the original status), not the boost wrapper's own id,
   * so the same post boosted twice by different users appears only once.
   *
   * @param page - The raw statuses from the API.
   * @returns The subset not already in `seenIds`, with each new id recorded.
   */
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

  /**
   * Prepend a freshly posted status at the top of the timeline (optimistic).
   * Called by the embedded `ComposeBox` after a successful `postStatus()` so
   * the E2E test can assert the post is visible immediately.
   *
   * @param status - The newly created {@link Status} from the compose response.
   */
  onPosted(status: Status): void {
    const key = status.reblog ? status.reblog.id : status.id;
    if (!this.seenIds.has(key)) {
      this.seenIds.add(key);
      this.toots.set([status, ...this.toots()]);
    }
  }

  /**
   * Navigate to the status thread view for the given status (or its inner
   * reblog, for boost wrappers).
   *
   * @param s - The status to navigate to.
   */
  goToStatus(s: Status): void {
    const target = s.reblog ? s.reblog : s;
    void this.router.navigate(['status', target.id], { relativeTo: this.siblingBase() });
  }

  /**
   * The route to resolve SIBLING routes against — every MASTODON_ROUTES entry is
   * a child of one parent, so its parent IS this remote's mount point.
   *
   * Absolute paths (`['/status', id]`) are WRONG under the host shell: the
   * injected Router is the SHELL's, whose root is `/`, so `/status/<id>` matched
   * nothing and the shell's fallback bounced the user to `/user` — clicking a
   * post's reply bubble navigated away from Mastodon entirely (operator report
   * 2026-08-14). It only appeared to work when the remote was loaded DIRECTLY at
   * /social/mastodon/, where its own router owns the URL. Resolving relative to
   * the parent gives /social/mastodon/status/<id> under the shell and
   * /status/<id> standalone — correct in both mounts, with no hardcoded mount
   * path for the remote to drift from.
   */
  private siblingBase(): ActivatedRoute {
    return this.route.parent ?? this.route;
  }

  /**
   * Navigate to the hashtag timeline for the given tag.
   *
   * @param tag - The bare tag string (without `#`).
   */
  goToHashtag(tag: string): void {
    void this.router.navigate(['tags', tag], { relativeTo: this.siblingBase() });
  }
}
