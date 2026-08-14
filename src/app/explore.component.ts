import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MastodonService, Status, Tag, PreviewCard } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';
import { mountRoute } from './mount-route';

type ExploreTab = 'posts' | 'tags' | 'links';

/** Mastodon Explore feature: trending Posts / Hashtags / News-Links tabs with
 *  offset-based load more. */
@Component({
  selector: 'hug-mastodon-explore',
  standalone: true,
  imports: [CommonModule, RouterLink, TootCardComponent],
  templateUrl: './explore.component.html',
  styleUrl: './explore.component.scss',
})
export class ExploreComponent implements OnInit {
  /** This remote's mount point — every in-app link resolves against it
   *  (see mount-route.ts: absolute links bounce out of the remote). */
  readonly mount = mountRoute();
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
