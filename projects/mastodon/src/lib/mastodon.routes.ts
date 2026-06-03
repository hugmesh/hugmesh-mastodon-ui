import { Routes } from '@angular/router';
import { MastodonTimelineComponent } from './mastodon-timeline.component';

/** Lazy-loadable routes for the Mastodon module. Mounted by the host at
 *  /social/mastodon (see host app.routes.ts). */
export const MASTODON_ROUTES: Routes = [
  { path: '', component: MastodonTimelineComponent },
];
