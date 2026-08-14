import { inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/**
 * This remote's MOUNT POINT, as an ActivatedRoute to resolve links against.
 *
 * Every MASTODON_ROUTES entry is a sibling under one parent, so the parent of
 * whatever route is active IS where this remote is mounted: `/social/mastodon`
 * under the host shell, `/` when the remote runs standalone.
 *
 * Absolute in-app links (`['/status', id]`, `['/account', acct]`) are WRONG
 * under the shell: the injected Router is the SHELL's, whose root is `/`, so
 * they matched nothing and the shell's fallback bounced the user to `/user` —
 * clicking a post's reply bubble or an avatar navigated out of Mastodon
 * entirely (operator report 2026-08-14). They only appeared to work when the
 * remote was loaded DIRECTLY at /social/mastodon/, where its own router owns
 * the URL. Pairing a RELATIVE link with `[relativeTo]="mount"` is correct in
 * both mounts and hardcodes no mount path the remote could drift from.
 */
export function mountRoute(): ActivatedRoute {
  const route = inject(ActivatedRoute);
  return route.parent ?? route;
}
