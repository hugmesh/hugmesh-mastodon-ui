import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MastodonService, SearchResults, Account } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { accessibleName } from './accessible-name';

type SearchType = 'all' | 'accounts' | 'hashtags' | 'statuses';

/** Mastodon Search / Explore search: one query box bound to /api/v2/search with
 *  Accounts / Hashtags / Statuses sections and type filter tabs. */
@Component({
  selector: 'snap-mastodon-search',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TootCardComponent],
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

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  trackId = (_: number, s: { id: string }): string => s.id;

  showSection(section: SearchType): boolean {
    return this.type() === 'all' || this.type() === section;
  }

  /** Screen-reader name for an account result: ASCII screenReaderName when
   *  supplied, else display_name, else @username. Feeds the avatar alt so a
   *  non-ASCII display name is announced via its ASCII name. */
  accountName(a: Account): string {
    return accessibleName(a.display_name || a.username, a.screen_reader_name);
  }

  onQueryChange(q: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (!q.trim()) {
      this.results.set({ accounts: [], statuses: [], hashtags: [] });
      return;
    }
    this.debounceTimer = setTimeout(() => void this.runSearch(), 350);
  }

  selectType(t: SearchType): void {
    if (this.type() === t) return;
    this.type.set(t);
    if (this.query.trim()) void this.runSearch();
  }

  private async runSearch(): Promise<void> {
    const q = this.query.trim();
    if (!q) return;
    this.loading.set(true);
    try {
      const opts: { type?: 'accounts' | 'hashtags' | 'statuses'; resolve: boolean } = { resolve: true };
      const t = this.type();
      if (t !== 'all') opts.type = t;
      const res = await this.mastodon.search(q, opts);
      this.results.set(res);
    } finally {
      this.loading.set(false);
    }
  }
}
