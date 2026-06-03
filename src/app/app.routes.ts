import { Routes } from '@angular/router';
import { MASTODON_ROUTES } from './mastodon.routes';

/** Dev-shell routes: mount the exposed Mastodon routes at the root so the remote
 *  is browsable standalone. The host ignores this and loads `./routes`. */
export const routes: Routes = [{ path: '', children: MASTODON_ROUTES }];
