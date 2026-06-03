import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MastodonService, Status, Tag, PreviewCard } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';

type ExploreTab = 'posts' | 'tags' | 'links';

/** Mastodon Explore feature: trending Posts / Hashtags / News-Links tabs with
 *  offset-based load more. */
@Component({
  selector: 'snap-mastodon-explore',
  standalone: true,
  imports: [CommonModule, RouterLink, TootCardComponent],
  template: `
    <section class="explore-view" data-testid="explore-view">
      <header class="column-head"><h2>Explore</h2></header>

      <nav class="explore-tabs">
        <button
          type="button"
          data-testid="explore-tab-posts"
          [class.active]="tab() === 'posts'"
          (click)="selectTab('posts')"
        >
          Posts
        </button>
        <button
          type="button"
          data-testid="explore-tab-tags"
          [class.active]="tab() === 'tags'"
          (click)="selectTab('tags')"
        >
          Hashtags
        </button>
        <button
          type="button"
          data-testid="explore-tab-links"
          [class.active]="tab() === 'links'"
          (click)="selectTab('links')"
        >
          News
        </button>
      </nav>

      <p *ngIf="loading()" class="loading">Loading…</p>

      <div *ngIf="tab() === 'posts'" class="explore-posts">
        <snap-mastodon-toot-card
          *ngFor="let s of posts(); trackBy: trackId"
          [status]="s"
        ></snap-mastodon-toot-card>
      </div>

      <div *ngIf="tab() === 'tags'" class="explore-tags">
        <a
          class="trending-tag"
          data-testid="explore-trending-tag"
          *ngFor="let t of tags()"
          [routerLink]="['/tags', t.name]"
        >
          #{{ t.name }}
        </a>
      </div>

      <div *ngIf="tab() === 'links'" class="explore-links">
        <a class="trending-link" *ngFor="let l of links()" [href]="l.url" target="_blank" rel="noopener">
          <img *ngIf="l.image" [src]="l.image" alt="" />
          <span class="link-title">{{ l.title }}</span>
          <span class="link-provider">{{ l.provider_name }}</span>
        </a>
      </div>

      <button
        *ngIf="!loading() && !exhausted()"
        type="button"
        class="load-more"
        (click)="loadMore()"
      >
        Load more
      </button>
    </section>
  `,
})
export class ExploreComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);

  readonly tab = signal<ExploreTab>('posts');
  readonly posts = signal<Status[]>([]);
  readonly tags = signal<Tag[]>([]);
  readonly links = signal<PreviewCard[]>([]);
  readonly loading = signal(false);
  readonly exhausted = signal(false);

  private offset = 0;

  trackId = (_: number, s: Status): string => s.id;

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  selectTab(tab: ExploreTab): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    void this.reload();
  }

  private async reload(): Promise<void> {
    this.offset = 0;
    this.exhausted.set(false);
    this.loading.set(true);
    try {
      await this.fetchInto(true);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.loading() || this.exhausted()) return;
    this.loading.set(true);
    try {
      await this.fetchInto(false);
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchInto(replace: boolean): Promise<void> {
    const limit = 20;
    if (this.tab() === 'posts') {
      const page = await this.mastodon.trendingStatuses(limit, this.offset);
      this.posts.set(replace ? page : [...this.posts(), ...page]);
      this.bump(page.length, limit);
    } else if (this.tab() === 'tags') {
      const page = await this.mastodon.trendingTags(limit, this.offset);
      this.tags.set(replace ? page : [...this.tags(), ...page]);
      this.bump(page.length, limit);
    } else {
      const page = await this.mastodon.trendingLinks(limit, this.offset);
      this.links.set(replace ? page : [...this.links(), ...page]);
      this.bump(page.length, limit);
    }
  }

  private bump(returned: number, limit: number): void {
    this.offset += returned;
    if (returned < limit) this.exhausted.set(true);
  }
}
