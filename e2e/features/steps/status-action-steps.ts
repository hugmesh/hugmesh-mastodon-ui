// Status-ACTION step definitions — boost / favourite / bookmark / reply, driven
// through the real toot-card action bar (toot-card.component.html) and observed
// cross-user. These extend the post-visibility wave's honesty contract to the
// per-status actions:
//
//   - BOOST is a REACH action (federated_ish — a booster's own home timeline
//     shows their boost, and the ORIGINAL author observes the reblog count
//     climb). Proven with a REAL click + the real POST response, not an
//     optimistic-UI assumption.
//   - FAVOURITE / BOOKMARK are PRIVATE-to-actor lists (GET /api/v1/favourites,
//     /api/v1/bookmarks always scope to the caller). Every scenario proves the
//     ALLOW (the actor's own list carries it) THEN the DENY (nobody else's list
//     ever does) — the honest ALLOW+DENY pair for a privacy-scoped feature.
//   - REPLY posts a real child status (in_reply_to_id) and is observed both as
//     an incremented reply count on the parent AND as a real descendant on the
//     parent's permalink thread.
//
// Every status acted on here is created by a DIFFERENT persona than the one
// performing the boost/favourite/bookmark/reply (victim-creates-first), so a
// pass can never be explained by the actor observing their own content.
//
// @cluster-only; bddgen still compiles these offline.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, statusRegistry, CreatedStatus } from './_registry';
import { TIMELINE_PATHS, expectStatusInTimeline, expectStatusAbsentFromTimeline } from '../../tests/helpers/social';

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

/** Locate the toot-card carrying `text` on the CURRENT page — scoped so a
 *  timeline with many cards is deterministic. */
function cardWithText(page: import('@playwright/test').Page, text: string) {
  return page.locator('[data-testid="toot-card"]', { hasText: text }).first();
}

/** Navigate to the federated (public) timeline and click a real action button
 *  (boost / favourite / bookmark) on the card carrying `tag`'s marker text,
 *  waiting for the real mutating response so the following assertions observe
 *  a settled state, not an optimistic one. */
async function clickCardAction(
  page: import('@playwright/test').Page,
  tag: string,
  action: 'toot-boost' | 'toot-favourite' | 'toot-bookmark',
  apiFragment: string,
): Promise<void> {
  const text = statusOf(tag).text;
  await page.goto(TIMELINE_PATHS.federated, { waitUntil: 'domcontentloaded' });
  const card = cardWithText(page, text);
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes(apiFragment) && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await card.locator(`[data-testid="${action}"]`).click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`"${action}" on "${tag}" failed: ${response.status()}`);
  }
}

// ── Boost ─────────────────────────────────────────────────────────────────

When('{string} boosts the {string} status', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  await clickCardAction(page, tag, 'toot-boost', '/reblog');
});

Then(
  '{string} sees their own boost of the {string} status in their home timeline within {int} seconds',
  async ({ user }, username: string, tag: string, seconds: number) => {
    // A booster's home timeline includes their own boosts (self + follows, per
    // the Mastodon home-timeline contract) — rendered with the boost-header
    // ("🔁 <booster> boosted") wrapping the original content.
    const page = pageOf(user(username).username);
    const text = statusOf(tag).text;
    await expect
      .poll(
        async () => {
          await page.goto(TIMELINE_PATHS.home, { waitUntil: 'domcontentloaded' });
          const card = cardWithText(page, text);
          if ((await card.count()) === 0) return false;
          return await card.locator('.boost-header').isVisible().catch(() => false);
        },
        {
          message: `${username}'s home timeline should show their own boost of "${text}" within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBe(true);
  },
);

Then(
  'the {string} status shows a boost count of {int} for {string} within {int} seconds',
  async ({ user }, tag: string, expected: number, username: string, seconds: number) => {
    // Observed from the AUTHOR's own timeline — the real reblogs_count the
    // homeserver reports, not the booster's optimistic local toggle.
    const page = pageOf(user(username).username);
    const text = statusOf(tag).text;
    await expect
      .poll(
        async () => {
          await page.goto(TIMELINE_PATHS.home, { waitUntil: 'domcontentloaded' });
          const card = cardWithText(page, text);
          if ((await card.count()) === 0) return -1;
          const raw = await card.locator('[data-testid="toot-reblog-count"]').first().textContent();
          return Number(raw ?? '-1');
        },
        {
          message: `"${text}" should show a boost count of ${expected} for ${username} within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBe(expected);
  },
);

// ── Favourite (PRIVATE to the favouriter) ────────────────────────────────────

When('{string} favourites the {string} status', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  await clickCardAction(page, tag, 'toot-favourite', '/favourite');
});

// ── Bookmark (PRIVATE to the bookmarker) ─────────────────────────────────────

When('{string} bookmarks the {string} status', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  await clickCardAction(page, tag, 'toot-bookmark', '/bookmark');
});

// ── Shared private-list ALLOW/DENY (favourites + bookmarks are both
//    Link-header "mine only" lists — the mastodon-timeline component reuses
//    the exact same feed/card markup for both, via TIMELINE_PATHS) ──────────

function asPrivateList(list: string): 'favourites' | 'bookmarks' {
  if (list !== 'favourites' && list !== 'bookmarks') throw new Error(`Unknown private list "${list}"`);
  return list;
}

Then(
  '{string} sees the {string} status in their {word} within {int} seconds',
  async ({ user }, username: string, tag: string, list: string, seconds: number) => {
    const page = pageOf(user(username).username);
    await expectStatusInTimeline(page, asPrivateList(list), statusOf(tag).text, seconds);
  },
);

Then(
  '{string} never sees the {string} status in their {word}',
  async ({ user }, username: string, tag: string, list: string) => {
    // Post-positive-control ordering: only meaningful AFTER the same scenario
    // proved the status was favourited/bookmarked by someone (the actor's own
    // list, asserted above). Favourites/bookmarks are per-account (GET always
    // scopes to the caller), so a DIFFERENT account's list must never carry it —
    // re-checked across full reload+settle cycles, never a fabricated id.
    const page = pageOf(user(username).username);
    await expectStatusAbsentFromTimeline(page, asPrivateList(list), statusOf(tag).text);
  },
);

// ── Reply ─────────────────────────────────────────────────────────────────

When(
  '{string} replies to the {string} status tagged {string}',
  async ({ user }, username: string, parentTag: string, replyTag: string) => {
    const parent = statusOf(parentTag);
    if (!parent.id) throw new Error(`status "${parentTag}" has no captured id — the posting step must capture it.`);
    const page = pageOf(user(username).username);
    await page.goto(`/social/mastodon/status/${parent.id}`, { waitUntil: 'domcontentloaded' });
    const replyBox = page.locator('[data-testid="status-reply-box"]');
    await replyBox.waitFor({ state: 'visible', timeout: 15_000 });
    const text = `e2e-${replyTag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await replyBox.locator('[data-testid="mastodon-input"]').fill(text);
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await replyBox.locator('[data-testid="mastodon-post"]').click();
    const response = await responsePromise;
    if (!response.ok()) throw new Error(`posting the reply "${replyTag}" failed: ${response.status()}`);
    const body = (await response.json()) as { id?: string; visibility?: string; in_reply_to_id?: string };
    expect(body.in_reply_to_id, 'the reply must be linked to its parent').toBe(parent.id);
    statusRegistry.set(replyTag, { text, id: body.id ?? null, visibility: body.visibility ?? null });
  },
);

Then(
  '{string} sees the {string} status among the replies to the {string} status within {int} seconds',
  async ({ user }, viewerUsername: string, replyTag: string, parentTag: string, seconds: number) => {
    const parent = statusOf(parentTag);
    if (!parent.id) throw new Error(`status "${parentTag}" has no captured id.`);
    const replyText = statusOf(replyTag).text;
    const page = pageOf(user(viewerUsername).username);
    await expect
      .poll(
        async () => {
          await page.goto(`/social/mastodon/status/${parent.id}`, { waitUntil: 'domcontentloaded' });
          const descendants = page.locator('[data-testid="status-descendants"]');
          if ((await descendants.count()) === 0) return 0;
          return await descendants.locator('[data-testid="toot-content"]', { hasText: replyText }).count();
        },
        {
          message: `"${replyText}" should appear among the replies to "${parentTag}" for ${viewerUsername} within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBeGreaterThan(0);
  },
);

Then(
  'the reply count for the {string} status reaches {int} for {string} within {int} seconds',
  async ({ user }, tag: string, expected: number, username: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const text = statusOf(tag).text;
    await expect
      .poll(
        async () => {
          await page.goto(TIMELINE_PATHS.home, { waitUntil: 'domcontentloaded' });
          const card = cardWithText(page, text);
          if ((await card.count()) === 0) return -1;
          const raw = await card.locator('[data-testid="toot-replies-count"]').first().textContent();
          return Number(raw ?? '-1');
        },
        {
          message: `reply count for "${text}" should reach ${expected} for ${username} within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBeGreaterThanOrEqual(expected);
  },
);
