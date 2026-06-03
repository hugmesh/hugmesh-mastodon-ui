import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MastodonService, Toot } from './mastodon.service';

/**
 * Standalone Mastodon timeline component. Federated into the snapdragon.systems
 * host and rendered at /social/mastodon for logged-in users.
 */
@Component({
  selector: 'snap-mastodon-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="snap-mastodon" data-testid="mastodon-view">
      <h2>Mastodon</h2>
      <div class="composer">
        <textarea data-testid="mastodon-input" [(ngModel)]="draft" placeholder="What's on your mind?"></textarea>
        <button data-testid="mastodon-post" (click)="post()" [disabled]="!draft.trim()">Toot</button>
      </div>
      <div data-testid="mastodon-timeline">
        <article *ngFor="let t of toots()" class="toot">
          <strong>{{ t.account.display_name || t.account.username }}</strong>
          <div [innerHTML]="t.content"></div>
          <time>{{ t.created_at }}</time>
        </article>
      </div>
    </section>
  `,
})
export class MastodonTimelineComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);
  readonly toots = signal<Toot[]>([]);
  draft = '';

  async ngOnInit(): Promise<void> {
    this.toots.set(await this.mastodon.homeTimeline());
  }

  async post(): Promise<void> {
    if (!this.draft.trim()) return;
    await this.mastodon.post(this.draft.trim());
    this.draft = '';
    this.toots.set(await this.mastodon.homeTimeline());
  }
}
