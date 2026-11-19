import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionService } from '../session.service';
import { StandaloneSessionService } from './standalone-session.service';

interface NavItem {
  readonly path: string;
  readonly label: string;
}

/**
 * The shell of a standalone deployment: a sign-in screen, then the navigation and the Mastodon routes.
 * It is used only by the `standalone` build (main.standalone.ts); under the HugMesh host shell the host
 * provides all of this and mounts `./routes` directly.
 */
@Component({
  selector: 'hug-standalone-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './standalone-shell.component.html',
  styleUrl: './standalone-shell.component.scss',
})
export class StandaloneShellComponent implements OnInit {
  protected readonly standalone = inject(StandaloneSessionService);
  protected readonly session = inject(SessionService);

  /** The instance's own title (Akkoma's public /api/v1/instance), for the header and the sign-in card. */
  protected readonly title = signal('Akkoma');

  protected readonly nav: readonly NavItem[] = [
    { path: '/home', label: 'Home' },
    { path: '/local', label: 'Local' },
    { path: '/public', label: 'Federated' },
    { path: '/notifications', label: 'Notifications' },
    { path: '/direct', label: 'Messages' },
    { path: '/explore', label: 'Explore' },
    { path: '/search', label: 'Search' },
    { path: '/lists', label: 'Lists' },
    { path: '/favourites', label: 'Favourites' },
    { path: '/bookmarks', label: 'Bookmarks' },
  ];

  async ngOnInit(): Promise<void> {
    void this.loadTitle();
    await this.standalone.init();
  }

  protected loginUrl(): string {
    return this.standalone.loginUrl();
  }

  protected signOut(): void {
    void this.standalone.signOut();
  }

  private async loadTitle(): Promise<void> {
    try {
      const r = await fetch('/api/v1/instance', { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const t = ((await r.json()) as { title?: string }).title;
      if (t && t.trim()) {
        this.title.set(t.trim());
        document.title = t.trim();
      }
    } catch {
      /* the default title stays */
    }
  }
}
