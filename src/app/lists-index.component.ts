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
  templateUrl: './lists-index.component.html',
  styleUrl: './lists-index.component.scss',
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
