import { APIRequestContext, Page, expect } from '@playwright/test';

/**
 * Federation / timeline helpers for the post-visibility, domain-lock and
 * mod-consequence waves. Everything here is CLUSTER-only (it drives a live
 * homeserver through the BFF hsproxy or the raw public API), matching the
 * @cluster tags on the features that call it.
 *
 * HONESTY RULES these helpers encode:
 *  - a scenario always CREATES its own status and observes the REAL text/id —
 *    no fabricated ids as oracles.
 *  - positive observation uses expect.poll (never a bare waitForTimeout).
 *  - NEGATIVE observation ("never appears") is only meaningful AFTER the same
 *    scenario proved delivery elsewhere (a positive control), so
 *    {@link expectStatusAbsentFromTimeline} documents + relies on that ordering
 *    and re-checks across several real reloads instead of sleeping.
 */

/** Raw (unauthenticated) homeserver base for the signed-out public-timeline
 *  oracle. Mastodon/Akkoma serve GET /api/v1/timelines/public without auth, so
 *  this is exactly what a signed-out visitor can observe. */
export function mastodonPublicBase(): string {
  return process.env['E2E_MASTODON_URL'] ?? 'https://mastodon.hugmesh.net';
}

/** Build a run-unique status marker for `tag`. The marker is the oracle every
 *  observation step greps for, so it must never collide across runs/retries. */
export function uniqueMarker(tag: string): string {
  return `e2e-${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a run-unique HASHTAG for `tag` — hashtags only carry word characters,
 *  so this drops the dashes {@link uniqueMarker} uses (a `#e2e-foo-1` tag would
 *  actually parse as just `#e2e`, silently truncating the marker and making a
 *  hashtag-search assertion pass for the wrong reason). */
export function uniqueHashtag(tag: string): string {
  return `e2e${tag}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9]/gi, '');
}

/** Route map from the feature-facing timeline names to the remote's routes
 *  (mastodon.routes.ts `data.source`). `favourites` / `bookmarks` are the
 *  PRIVATE-to-owner lists (Link-header paginated, never another account's) —
 *  included here so the shared poll helpers below cover them too. */
export const TIMELINE_PATHS = {
  home: '/social/mastodon',
  federated: '/social/mastodon/public',
  local: '/social/mastodon/local',
  favourites: '/social/mastodon/favourites',
  bookmarks: '/social/mastodon/bookmarks',
} as const;
export type TimelineName = keyof typeof TIMELINE_PATHS;

/** Ensure `page` sits on the app origin so relative same-origin fetches (the
 *  HttpOnly bff_ cookie-bearing API steps) resolve against the front door. */
async function ensureOnOrigin(page: Page): Promise<void> {
  if (page.url() === 'about:blank') {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }
}

interface FollowOutcome {
  error?: string;
  /** The resolved target account id — needed for the relationship poll. */
  id?: string;
  following?: boolean;
  requested?: boolean;
}

/**
 * FOLLOWER-RELATIONSHIP SEED: make the user driving `page` follow `targetAcct`
 * through the real homeserver API (search-resolve → follow), via the same
 * HttpOnly bff_ cookie hsproxy channel the API-DENY steps already use.
 * `resolve=true` webfingers a remote handle, so a cross-domain follow works
 * when the runner exports the full `user@host` acct (see roles.acctFor).
 *
 * HONEST + FEDERATION-AWARE: a CROSS-DOMAIN follow legitimately answers
 * `requested: true / following: false` until the remote Accept round-trips, so
 * after the POST this seed expect.polls GET /accounts/relationships until the
 * Relationship reports `following: true`. It still FAILS (poll timeout) if the
 * Accept never lands (an MRF-swallowed Accept is a broken precondition, not a
 * pass) — the lag is absorbed, the claim is not weakened.
 */
export async function followViaApi(page: Page, targetAcct: string, timeoutSeconds = 90): Promise<void> {
  await ensureOnOrigin(page);
  const outcome = await page.evaluate<FollowOutcome, string>(async (acct) => {
    const search = await fetch(
      `/bff/user/mastodon/api/v2/search?q=${encodeURIComponent(acct)}&resolve=true&type=accounts&limit=5`,
      { credentials: 'include' },
    );
    if (!search.ok) return { error: `account search failed: ${search.status}` };
    const results = (await search.json()) as { accounts?: Array<{ id: string; acct: string; username: string }> };
    const account = (results.accounts ?? []).find(
      (a) => a.acct === acct || a.username === acct || a.acct.startsWith(`${acct}@`),
    );
    if (!account) return { error: `account "${acct}" not resolved` };
    const follow = await fetch(`/bff/user/mastodon/api/v1/accounts/${encodeURIComponent(account.id)}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!follow.ok) return { error: `follow failed: ${follow.status}` };
    const rel = (await follow.json()) as { following?: boolean; requested?: boolean };
    return { id: account.id, following: rel.following === true, requested: rel.requested === true };
  }, targetAcct);
  if (outcome.error) throw new Error(`follower seed for "${targetAcct}": ${outcome.error}`);
  if (outcome.following) return;

  // Not yet `following` — for a remote target that is the NORMAL transient
  // (`requested`) while the Accept federates back. Poll the REAL relationship;
  // only an observed `following: true` establishes the precondition.
  await expect
    .poll(
      async () =>
        await page.evaluate<boolean, string>(async (id) => {
          const res = await fetch(
            `/bff/user/mastodon/api/v1/accounts/relationships?id[]=${encodeURIComponent(id)}`,
            { credentials: 'include' },
          );
          if (!res.ok) return false;
          const rels = (await res.json()) as Array<{ following?: boolean }>;
          return rels.some((r) => r.following === true);
        }, outcome.id as string),
      {
        message:
          `follower seed for "${targetAcct}" never confirmed following:true ` +
          `(POST answered requested=${outcome.requested}) — the relationship precondition is NOT ` +
          'established, so the scenario must fail here, not later.',
        timeout: timeoutSeconds * 1_000,
        intervals: [2_000, 3_000, 5_000],
      },
    )
    .toBe(true);
}

/** Wait for the timeline feed to finish a load pass: the feed landmark visible
 *  and its aria-busy flag settled to "false" (the component's real loading
 *  contract) — so an absence check never reads a still-loading list as empty. */
async function waitForFeedSettled(page: Page): Promise<void> {
  const feed = page.locator('[data-testid="mastodon-timeline"]');
  await feed.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(feed).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
}

/** Count rendered toots whose content carries `text`. */
function tootsWithText(page: Page, text: string) {
  return page.locator('[data-testid="toot-content"]', { hasText: text });
}

/**
 * TIMELINE-POLL (positive): "the status appears in <page>'s <timeline> within
 * N seconds". expect.poll navigates + re-reads the REAL feed each interval —
 * federation/streaming lag is absorbed by re-fetching, never by sleeping.
 */
export async function expectStatusInTimeline(
  page: Page,
  timeline: TimelineName,
  text: string,
  timeoutSeconds: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          await page.goto(TIMELINE_PATHS[timeline], { waitUntil: 'domcontentloaded' });
          await waitForFeedSettled(page);
          return await tootsWithText(page, text).count();
        } catch {
          return 0; // transient load hiccup — the next poll pass re-navigates
        }
      },
      {
        message: `status "${text}" should appear in the ${timeline} timeline within ${timeoutSeconds}s`,
        timeout: timeoutSeconds * 1_000,
        intervals: [2_000, 3_000, 5_000],
      },
    )
    .toBeGreaterThan(0);
}

/**
 * TIMELINE-POLL (negative): the status stays ABSENT across `passes` full
 * reload+settle cycles. ONLY honest when the same scenario already proved the
 * status was delivered somewhere else (the positive control) — callers must
 * order their steps that way. No bare waitForTimeout: pacing comes from the
 * real navigation + feed-settle round trips.
 */
export async function expectStatusAbsentFromTimeline(
  page: Page,
  timeline: TimelineName,
  text: string,
  passes = 3,
): Promise<void> {
  for (let i = 0; i < passes; i++) {
    await page.goto(TIMELINE_PATHS[timeline], { waitUntil: 'domcontentloaded' });
    await waitForFeedSettled(page);
    await expect(
      tootsWithText(page, text),
      `status "${text}" must never appear in the ${timeline} timeline (pass ${i + 1}/${passes})`,
    ).toHaveCount(0);
  }
}

/** Does the SIGNED-OUT (unauthenticated) public timeline carry `marker`?
 *  Reads the raw homeserver endpoint — the exact surface an anonymous visitor
 *  gets — and throws on a non-OK response instead of treating it as absence. */
export async function publicTimelineContains(request: APIRequestContext, marker: string): Promise<boolean> {
  const res = await request.get(`${mastodonPublicBase()}/api/v1/timelines/public?limit=40`, {
    ignoreHTTPSErrors: true,
  });
  if (!res.ok()) {
    throw new Error(`signed-out public timeline fetch failed: ${res.status()} — cannot prove anything`);
  }
  return (await res.text()).includes(marker);
}
