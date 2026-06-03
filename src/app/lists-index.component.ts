import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MastodonService, MastodonList } from './mastodon.service';

/** Mastodon Lists feature: renders all user-defined lists, each linking to its
 *  list timeline (lists/:id), showing the replies_policy. */
@Component({
  selector: 'snap-mastodon-lists-index',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="lists-index" data-testid="lists-index">
      <header class="column-head"><h2>Lists</h2></header>

      <p *ngIf="loading() && !lists().length" class="loading">Loading…</p>
      <p *ngIf="!loading() && !lists().length" class="empty">You have no lists yet.</p>

      <ul class="list-rows">
        <li class="list-item" data-testid="list-item" *ngFor="let l of lists(); trackBy: trackId">
          <a [routerLink]="['/lists', l.id]" class="list-link">{{ l.title }}</a>
          <span class="replies-policy">replies: {{ l.replies_policy }}</span>
        </li>
      </ul>
    </section>
  `,
})
export class ListsIndexComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);

  readonly lists = signal<MastodonList[]>([]);
  readonly loading = signal(false);

  trackId = (_: number, l: MastodonList): string => l.id;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      this.lists.set(await this.mastodon.lists());
    } finally {
      this.loading.set(false);
    }
  }
}
