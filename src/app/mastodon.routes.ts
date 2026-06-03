import { Routes } from '@angular/router';
import { MastodonTimelineComponent } from './mastodon-timeline.component';
import { StatusDetailComponent } from './status-detail.component';
import { AccountProfileComponent } from './account-profile.component';
import { NotificationsColumnComponent } from './notifications-column.component';
import { SearchComponent } from './search.component';
import { ExploreComponent } from './explore.component';
import { ConversationsColumnComponent } from './conversations-column.component';
import { ListsIndexComponent } from './lists-index.component';

/** Lazy-loadable routes for the Mastodon module. Mounted by the host at
 *  /social/mastodon (see host app.routes.ts).
 *
 *  The single MastodonTimelineComponent shell is reused across home / local /
 *  public / hashtag / list / favourites / bookmarks via route `data.source`
 *  (and the :tag / :id route params). */
export const MASTODON_ROUTES: Routes = [
  { path: '', component: MastodonTimelineComponent, data: { source: 'home' } },
  { path: 'home', component: MastodonTimelineComponent, data: { source: 'home' } },
  { path: 'local', component: MastodonTimelineComponent, data: { source: 'community' } },
  { path: 'public', component: MastodonTimelineComponent, data: { source: 'public' } },
  { path: 'tags/:tag', component: MastodonTimelineComponent, data: { source: 'hashtag' } },
  { path: 'status/:id', component: StatusDetailComponent },
  { path: 'account/:acct', component: AccountProfileComponent },
  { path: 'notifications', component: NotificationsColumnComponent },
  { path: 'search', component: SearchComponent },
  { path: 'explore', component: ExploreComponent },
  { path: 'favourites', component: MastodonTimelineComponent, data: { source: 'favourites' } },
  { path: 'bookmarks', component: MastodonTimelineComponent, data: { source: 'bookmarks' } },
  { path: 'direct', component: ConversationsColumnComponent },
  { path: 'lists', component: ListsIndexComponent },
  { path: 'lists/:id', component: MastodonTimelineComponent, data: { source: 'list' } },
];
