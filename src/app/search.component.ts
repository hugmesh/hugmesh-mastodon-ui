import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MastodonService, SearchResults } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';

type SearchType = 'all' | 'accounts' | 'hashtags' | 'statuses';

/** Mastodon Search / Explore search: one query box bound to /api/v2/search with
 *  Accounts / Hashtags / Statuses sections and type filter tabs. */
@Component({
  selector: 'snap-mastodon-search',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TootCardComponent],
  template: `
    <section class="search-view" data-testid="search-view">
      <header class="column-head">
        <h2>Search</h2>
        <input
          type="search"
          data-testid="search-input"
          [(ngModel)]="query"
          (ngModelChange)="onQueryChange($event)"
          placeholder="Search posts, people, and hashtags"
        />
      </header>

      <nav class="search-tabs" data-testid="search-type-filter">
        <button
          type="button"
          *ngFor="let t of types"
          [class.active]="type() === t"
          (click)="selectType(t)"
        >
          {{ t }}
        </button>
      </nav>

      <p *ngIf="loading()" class="loading">Searching…</p>

      <div class="search-section" data-testid="search-results-accounts" *ngIf="showSection('accounts')">
        <h3 *ngIf="results().accounts.length">People</h3>
        <a
          class="account-row"
          *ngFor="let a of results().accounts"
          [routerLink]="['/account', a.acct]"
        >
          <img *ngIf="a.avatar" [src]="a.avatar" alt="" width="32" height="32" />
          <span class="name">{{ a.display_name || a.username }}</span>
          <span class="acct">&#64;{{ a.acct }}</span>
        </a>
      </div>

      <div class="search-section" data-testid="search-results-hashtags" *ngIf="showSection('hashtags')">
        <h3 *ngIf="results().hashtags.length">Hashtags</h3>
        <a class="hashtag-row" *ngFor="let h of results().hashtags" [routerLink]="['/tags', h.name]">
          #{{ h.name }}
        </a>
      </div>

      <div class="search-section" data-testid="search-results-statuses" *ngIf="showSection('statuses')">
        <h3 *ngIf="results().statuses.length">Posts</h3>
        <snap-mastodon-toot-card
          *ngFor="let s of results().statuses; trackBy: trackId"
          [status]="s"
        ></snap-mastodon-toot-card>
      </div>
    </section>
  `,
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
