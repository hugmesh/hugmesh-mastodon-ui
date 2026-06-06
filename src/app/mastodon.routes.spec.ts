import { MASTODON_ROUTES } from './mastodon.routes';
import { MastodonTimelineComponent } from './mastodon-timeline.component';
import { StatusDetailComponent } from './status-detail.component';
import { AccountProfileComponent } from './account-profile.component';
import { NotificationsColumnComponent } from './notifications-column.component';
import { SearchComponent } from './search.component';
import { ExploreComponent } from './explore.component';
import { ConversationsColumnComponent } from './conversations-column.component';
import { ListsIndexComponent } from './lists-index.component';

/**
 * These specs lock down the federation contract: `./routes` (exposed under the
 * remote name "mastodon") is the single module the snapdragon.systems host
 * mounts at /social/mastodon. The host depends on these paths, components and
 * `data.source` values, so a regression here would silently break the host.
 */
describe('MASTODON_ROUTES (exposed ./routes federation contract)', () => {
  const byPath = (path: string) => MASTODON_ROUTES.find((r) => r.path === path);

  it('exposes the timeline shell at the empty path (default mount point)', () => {
    const root = byPath('');
    expect(root).toBeDefined();
    expect(root!.component).toBe(MastodonTimelineComponent);
    expect(root!.data).toEqual({ source: 'home' });
  });

  it('reuses the timeline shell for home/local/public with the right data.source', () => {
    expect(byPath('home')!.component).toBe(MastodonTimelineComponent);
    expect(byPath('home')!.data).toEqual({ source: 'home' });
    expect(byPath('local')!.data).toEqual({ source: 'community' });
    expect(byPath('public')!.data).toEqual({ source: 'public' });
    expect(byPath('favourites')!.data).toEqual({ source: 'favourites' });
    expect(byPath('bookmarks')!.data).toEqual({ source: 'bookmarks' });
  });

  it('maps parameterised hashtag and list routes to the timeline shell', () => {
    expect(byPath('tags/:tag')!.component).toBe(MastodonTimelineComponent);
    expect(byPath('tags/:tag')!.data).toEqual({ source: 'hashtag' });
    expect(byPath('lists/:id')!.component).toBe(MastodonTimelineComponent);
    expect(byPath('lists/:id')!.data).toEqual({ source: 'list' });
  });

  it('wires each feature route to its dedicated component', () => {
    expect(byPath('status/:id')!.component).toBe(StatusDetailComponent);
    expect(byPath('account/:acct')!.component).toBe(AccountProfileComponent);
    expect(byPath('notifications')!.component).toBe(NotificationsColumnComponent);
    expect(byPath('search')!.component).toBe(SearchComponent);
    expect(byPath('explore')!.component).toBe(ExploreComponent);
    expect(byPath('direct')!.component).toBe(ConversationsColumnComponent);
    expect(byPath('lists')!.component).toBe(ListsIndexComponent);
  });

  it('declares every route with either a component or children (no dead routes)', () => {
    for (const route of MASTODON_ROUTES) {
      expect(route.component || route.children).withContext(`route ${route.path}`).toBeTruthy();
    }
  });

  it('contains no duplicate paths', () => {
    const paths = MASTODON_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
