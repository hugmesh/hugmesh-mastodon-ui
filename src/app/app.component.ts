import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Standalone dev shell for the Mastodon remote. Only used when this remote is
 * run on its own (`ng serve mastodon`); in production the snapdragon.systems
 * host federates `./routes` (MASTODON_ROUTES) directly — this shell is not loaded.
 */
@Component({
  selector: 'snap-mastodon-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {}
