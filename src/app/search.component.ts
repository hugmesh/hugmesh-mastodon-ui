import { Component, signal, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MastodonService, SearchResults, Account } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { accessibleName } from './accessible-name';

type SearchType = 'all' | 'accounts' | 'hashtags' | 'statuses';

/** Mastodon Search / Explore search: one query box bound to /api/v2/search with
 *  Accounts / Hashtags / Statuses sections and type filter tabs. */
@Component({
  selector: 'hug-mastodon-search',
  standalone: true,
  imports: [FormsModule, RouterLink, TootCardComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
})
export class SearchComponent {
  private readonly mastodon = inject(MastodonService);

  readonly types: SearchType[] = ['all', 'accounts', 'hashtags', 'statuses'];

  query = '';
  readonly type = signal<SearchType>('all');
  readonly results = signal<SearchResults>({ accounts: [], statuses: [], hashtags: [] });
  readonly loading = signal(false);

  /** Debounce timer handle; cleared on each keystroke before the 350 ms fires. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Track-by for search result lists.
   *
   * @param _ - Unused list index.
   * @param s - Any item with a string `id`.
   * @returns The item's id string.
   */
  trackId = (_: number, s: { id: string }): string => s.id;

  /**
   * Whether to show a given result section given the active type filter.
   *
   * @param section - The section type to test.
   * @returns `true` when the filter is `'all'` or matches the section.
   */
  showSection(section: SearchType): boolean {
    return this.type() === 'all' || this.type() === section;
  }

  /**
   * Accessible name for an account result. Returns the ASCII `screenReaderName`
   * when supplied, else `display_name`, else `@username`. Feeds the avatar `alt`
   * so non-ASCII display names are announced via their ASCII counterpart.
   *
   * @param a - The account result.
   * @returns A pronounceable, ASCII-safe name string.
   */
  accountName(a: Account): string {
    return accessibleName(a.display_name || a.username, a.screen_reader_name);
  }

  /**
   * Debounced search trigger: clears the results immediately on blank input
   * and fires a search 350 ms after the last keystroke.
   *
   * @param q - The current query string from the input binding.
   */
  onQueryChange(q: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (!q.trim()) {
      // Empty query: clear results immediately, no network call.
      this.results.set({ accounts: [], statuses: [], hashtags: [] });
      return;
    }
    // Wait 350 ms after the user stops typing before hitting the API.
    this.debounceTimer = setTimeout(() => void this.runSearch(), 350);
  }

  /**
   * Switch the type filter and immediately re-run the search when a query
   * is already present. No-ops when the type is unchanged.
   *
   * @param t - The filter type to select.
   */
  selectType(t: SearchType): void {
    if (this.type() === t) return;
    this.type.set(t);
    if (this.query.trim()) void this.runSearch();
  }

  /**
   * Execute the search against GET /api/v2/search.
   * `resolve: true` instructs the homeserver to WebFinger-resolve remote
   * accounts/hashtags that are not yet locally known.
   */
  private async runSearch(): Promise<void> {
    const q = this.query.trim();
    if (!q) return;
    this.loading.set(true);
    try {
      const opts: { type?: 'accounts' | 'hashtags' | 'statuses'; resolve: boolean } = { resolve: true };
      const t = this.type();
      // Pass the type filter only when a specific section is selected.
      if (t !== 'all') opts.type = t;
      const res = await this.mastodon.search(q, opts);
      this.results.set(res);
    } finally {
      this.loading.set(false);
    }
  }
}
