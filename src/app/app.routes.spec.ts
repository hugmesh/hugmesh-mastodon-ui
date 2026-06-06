import { routes } from './app.routes';
import { MASTODON_ROUTES } from './mastodon.routes';

/**
 * The dev-shell routes (used only by `ng serve mastodon` standalone) must mount
 * the exact same MASTODON_ROUTES the host federates, so standalone behaviour
 * matches the federated behaviour.
 */
describe('app.routes (standalone dev shell)', () => {
  it('mounts the exposed MASTODON_ROUTES as children of the root path', () => {
    expect(routes.length).toBe(1);
    expect(routes[0].path).toBe('');
    expect(routes[0].children).toBe(MASTODON_ROUTES);
  });
});
