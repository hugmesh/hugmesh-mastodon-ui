// Post-creation + timeline-observation step definitions — the Akkoma post
// VISIBILITY matrix (public | unlisted | private | direct) and its restriction
// consequences, observed across per-persona browser contexts.
//
// HONESTY CONTRACT (the platform test standard):
//   - every scenario CREATES its own status through the real composer and
//     captures the REAL id/visibility off the POST /api/v1/statuses response —
//     no fabricated ids as oracles.
//   - positive observation is an expect.poll over real timeline reloads (see
//     tests/helpers/social.ts); NEGATIVE observation ("never appears") is only
//     asserted AFTER the same scenario proved delivery elsewhere (the positive
//     control), and re-checks across full reload+settle cycles — never a bare
//     waitForTimeout.
//   - the signed-out oracle is the RAW unauthenticated homeserver public
//     timeline (exactly what an anonymous visitor can read), because the host
//     social guard bounces a signed-out browser before the UI ever renders.
//
// All of these live in @cluster features (they need the host + BFF + a live
// homeserver pair); bddgen still compiles them so `--list` proves they parse.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, statusRegistry, CreatedStatus } from './_registry';
import { acctFor } from '../../tests/helpers/roles';
import {
  TIMELINE_PATHS,
  TimelineName,
  expectStatusAbsentFromTimeline,
  expectStatusInTimeline,
  followViaApi,
  mastodonPublicBase,
  publicTimelineContains,
  uniqueMarker,
} from '../../tests/helpers/social';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

function statusOf(tag: string): CreatedStatus {
  const created = statusRegistry.get(tag);
  if (!created) {
    throw new Error(`No status tagged "${tag}" was created in this scenario — add a posting step first.`);
  }
  return created;
}

const KNOWN_TIMELINES: TimelineName[] = ['home', 'federated', 'local', 'favourites', 'bookmarks'];

function asTimeline(name: string): TimelineName {
  if (!(KNOWN_TIMELINES as string[]).includes(name)) {
    throw new Error(`Unknown timeline "${name}" — use ${KNOWN_TIMELINES.join(' | ')}.`);
  }
  return name as TimelineName;
}

// ── Follower-relationship seed (real API, asserted `following: true`) ───────

Given('{string} follows {string} on mastodon', async ({ user }, follower: string, target: string) => {
  const page = pageOf(user(follower).username);
  // acctFor lets a live multi-domain run address the remote handle
  // (E2E_<USER>_ACCT=user@host) so the search-resolve can webfinger it.
  await followViaApi(page, acctFor(user(target)));
});

// ── Posting through the real composer ────────────────────────────────────────

/** Drive the composer on the CURRENT page (the home timeline hosts it), select
 *  `visibility`, submit, and capture the created status off the real POST
 *  response. Fails if the server did not honour the requested visibility.
 *  Exported so other step files (notifications, search) can compose a real
 *  status with a mention/hashtag prefix instead of duplicating the POST +
 *  honest-visibility-oracle plumbing. */
export async function postViaComposer(
  page: import('@playwright/test').Page,
  tag: string,
  visibility: 'public' | 'unlisted' | 'private' | 'direct',
  textPrefix = '',
): Promise<void> {
  const text = `${textPrefix}${uniqueMarker(tag)}`;
  await page.locator('[data-testid="compose-visibility"]').selectOption(visibility);
  await page.locator('[data-testid="mastodon-input"]').fill(text);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.locator('[data-testid="mastodon-post"]').click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`posting the "${tag}" status failed: ${response.status()}`);
  }
  const body = (await response.json()) as { id?: string; visibility?: string };
  // HONEST oracle: the server must have accepted the REQUESTED visibility — a
  // silently rewritten reach would invalidate every observation that follows.
  expect(body.visibility, `server must honour the requested "${visibility}" visibility`).toBe(visibility);
  statusRegistry.set(tag, { text, id: body.id ?? null, visibility: body.visibility ?? null });
}

When(
  '{string} posts a(n) {string} status tagged {string}',
  async ({ user }, username: string, visibility: string, tag: string) => {
    const page = pageOf(user(username).username);
    if (visibility !== 'public' && visibility !== 'unlisted' && visibility !== 'private' && visibility !== 'direct') {
      throw new Error(`Unknown visibility "${visibility}"`);
    }
    await postViaComposer(page, tag, visibility);
  },
);

When(
  '{string} posts a direct status to {string} tagged {string}',
  async ({ user }, username: string, mentioned: string, tag: string) => {
    const page = pageOf(user(username).username);
    // A direct status reaches ONLY the mentioned accounts — the mention is the
    // addressing, so it leads the text.
    await postViaComposer(page, tag, 'direct', `@${acctFor(user(mentioned))} `);
  },
);

// ── Timeline observation: positive (poll) + negative (post-positive-control) ─

Then(
  'the {string} status appears in the {word} timeline of {string} within {int} seconds',
  async ({ user }, tag: string, timeline: string, username: string, seconds: number) => {
    const page = pageOf(user(username).username);
    await expectStatusInTimeline(page, asTimeline(timeline), statusOf(tag).text, seconds);
  },
);

Then(
  'the {string} status never appears in the {word} timeline of {string}',
  async ({ user }, tag: string, timeline: string, username: string) => {
    // ONLY honest after the scenario's positive control proved this status was
    // created and delivered somewhere observable — order the feature that way.
    const page = pageOf(user(username).username);
    await expectStatusAbsentFromTimeline(page, asTimeline(timeline), statusOf(tag).text);
  },
);

Then(
  'the {string} status disappears from the {word} timeline of {string} within {int} seconds',
  async ({ user }, tag: string, timeline: string, username: string, seconds: number) => {
    // The inverse consequence poll: the status WAS observed here earlier in the
    // scenario (the positive control), and a moderation action must now remove
    // it. Poll real reloads until the feed no longer carries it — an
    // enforcement leg that never lands keeps the status visible and FAILS this
    // step (the honest outcome; we never fake the consequence).
    const page = pageOf(user(username).username);
    const text = statusOf(tag).text;
    const name = asTimeline(timeline);
    await expect
      .poll(
        async () => {
          try {
            await page.goto(TIMELINE_PATHS[name], { waitUntil: 'domcontentloaded' });
            const feed = page.locator('[data-testid="mastodon-timeline"]');
            await feed.waitFor({ state: 'visible', timeout: 15_000 });
            await expect(feed).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
            return await page.locator('[data-testid="toot-content"]', { hasText: text }).count();
          } catch {
            return 1; // transient load hiccup — retry; only a settled 0 passes
          }
        },
        {
          message: `status "${text}" should disappear from the ${name} timeline within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [3_000, 5_000],
        },
      )
      .toBe(0);
  },
);

Then(
  '{string} sees the {string} status on its permalink',
  async ({ user }, username: string, tag: string) => {
    const created = statusOf(tag);
    if (!created.id) throw new Error(`status "${tag}" has no captured id — the posting step must capture it.`);
    const page = pageOf(user(username).username);
    // Status ids are instance-local, so the observer must live on the SAME
    // homeserver as the author (see roles.ts user-c).
    await page.goto(`/social/mastodon/status/${created.id}`, { waitUntil: 'domcontentloaded' });
    const focused = page.locator('[data-testid="status-focused"]');
    await expect(focused).toBeVisible({ timeout: 15_000 });
    await expect(focused.locator('[data-testid="toot-content"]')).toContainText(created.text, { timeout: 15_000 });
  },
);

Then(
  'the {string} status appears in the conversations of {string} within {int} seconds',
  async ({ user }, tag: string, username: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const text = statusOf(tag).text;
    await expect
      .poll(
        async () => {
          try {
            await page.goto('/social/mastodon/direct', { waitUntil: 'domcontentloaded' });
            await page.locator('[data-testid="conversations-column"]').waitFor({ state: 'visible', timeout: 15_000 });
            return await page.locator('[data-testid="conversation-item"]', { hasText: text }).count();
          } catch {
            return 0;
          }
        },
        {
          message: `direct status "${text}" should reach the conversations of ${username} within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBeGreaterThan(0);
  },
);

// ── Signed-out oracle: the RAW unauthenticated public timeline ───────────────

Then(
  'the signed-out public timeline shows the {string} status within {int} seconds',
  async ({ request }, tag: string, seconds: number) => {
    const text = statusOf(tag).text;
    await expect
      .poll(async () => publicTimelineContains(request, text), {
        message: `the anonymous public timeline should carry "${text}" within ${seconds}s`,
        timeout: seconds * 1_000,
        intervals: [2_000, 3_000, 5_000],
      })
      .toBe(true);
  },
);

Then('the signed-out public timeline never shows the {string} status', async ({ request }, tag: string) => {
  // Post-positive-control ordering applies here too: the scenario has already
  // proven the status exists (permalink / follower / author observation), so
  // three real re-fetches asserting absence are meaningful.
  const text = statusOf(tag).text;
  for (let pass = 0; pass < 3; pass++) {
    expect(
      await publicTimelineContains(request, text),
      `anonymous public timeline must never carry "${text}" (pass ${pass + 1}/3)`,
    ).toBe(false);
  }
});

Then('the anonymous permalink for the {string} status is denied', async ({ request }, tag: string) => {
  const created = statusOf(tag);
  if (!created.id) throw new Error(`status "${tag}" has no captured id — the posting step must capture it.`);
  // The REAL id, created by the victim in this very scenario — so this DENY
  // proves the homeserver fails closed for anonymous readers of a non-public
  // status (401 unauthenticated or 404 hidden are both fail-closed DENIALS).
  const res = await request.get(`${mastodonPublicBase()}/api/v1/statuses/${created.id}`, {
    ignoreHTTPSErrors: true,
  });
  expect([401, 404], `anonymous read of a private status must be denied, got ${res.status()}`).toContain(
    res.status(),
  );
});
