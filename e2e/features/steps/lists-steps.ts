// Lists step definitions — the lists index (lists-index.component.ts) and the
// `list` timeline source (mastodon-timeline.component.ts). This repo has no
// create-list UI (a recorded PRODUCT gap), so — exactly like the
// follower-relationship seed (tests/helpers/social.ts followViaApi) — the list
// is created + populated through the REAL homeserver API over the same
// same-origin hsproxy channel (POST /bff/user/mastodon/api/v1/lists, then
// /lists/:id/accounts), and its true id captured off the response. The UI under
// test is what renders that real list: the index rows + their links, and the
// /lists/:id timeline feed.
//
// @cluster-only (real POSTs need the live BFF + homeserver); bddgen still
// compiles these offline.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, statusRegistry } from './_registry';
import { acctFor } from '../../tests/helpers/roles';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** Feature-facing list TITLE → the real homeserver list id created for it, so
 *  the timeline/link steps address the true id, never a fabricated one. */
const listRegistry = new Map<string, string>();

function listIdOf(title: string): string {
  const id = listRegistry.get(title);
  if (!id) throw new Error(`No list titled "${title}" was created in this scenario.`);
  return id;
}

/** Ensure the page sits on the app origin so the same-origin bff_-cookie fetch
 *  resolves against the front door. */
async function ensureOnOrigin(page: Page): Promise<void> {
  if (page.url() === 'about:blank') await page.goto('/', { waitUntil: 'domcontentloaded' });
}

/** POST a new list through the real hsproxy and return its id (bff_ cookie rides
 *  via credentials:'include', exactly like followViaApi). */
async function createList(page: Page, title: string): Promise<string> {
  await ensureOnOrigin(page);
  const id = await page.evaluate<string, string>(async (t) => {
    const res = await fetch('/bff/user/mastodon/api/v1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title: t, replies_policy: 'list' }),
    });
    if (!res.ok) throw new Error(`create list failed: ${res.status}`);
    const list = (await res.json()) as { id: string };
    return list.id;
  }, title);
  return id;
}

/** Add the account resolved from `acct` to list `id` (the caller must already
 *  follow it — Mastodon rejects adding a non-followed account to a list). */
async function addAccountToList(page: Page, id: string, acct: string): Promise<void> {
  await ensureOnOrigin(page);
  const error = await page.evaluate<string | null, { id: string; acct: string }>(async ({ id: listId, acct: handle }) => {
    const search = await fetch(
      `/bff/user/mastodon/api/v2/search?q=${encodeURIComponent(handle)}&resolve=true&type=accounts&limit=5`,
      { credentials: 'include' },
    );
    if (!search.ok) return `account search failed: ${search.status}`;
    const results = (await search.json()) as { accounts?: Array<{ id: string; acct: string; username: string }> };
    const account = (results.accounts ?? []).find(
      (a) => a.acct === handle || a.username === handle || a.acct.startsWith(`${handle}@`),
    );
    if (!account) return `account "${handle}" not resolved`;
    const add = await fetch(`/bff/user/mastodon/api/v1/lists/${encodeURIComponent(listId)}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ account_ids: [account.id] }),
    });
    if (!add.ok) return `add-to-list failed: ${add.status}`;
    return null;
  }, { id, acct });
  if (error) throw new Error(`adding "${acct}" to list ${id}: ${error}`);
}

// ── Create (real API seed) ───────────────────────────────────────────────────

When('{string} creates a mastodon list named {string}', async ({ user }, username: string, title: string) => {
  const page = pageOf(user(username).username);
  listRegistry.set(title, await createList(page, title));
});

When(
  '{string} creates a mastodon list named {string} including {string}',
  async ({ user }, username: string, title: string, member: string) => {
    const page = pageOf(user(username).username);
    const id = await createList(page, title);
    listRegistry.set(title, id);
    await addAccountToList(page, id, acctFor(user(member)));
  },
);

// ── Index rendering + link navigation ────────────────────────────────────────

Then('{string} sees the {string} list in the lists index', async ({ user }, username: string, title: string) => {
  const page = pageOf(user(username).username);
  const row = page.locator('[data-testid="list-item"]', { hasText: title });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row.locator('[data-testid="list-link"]')).toHaveText(title, { timeout: 15_000 });
});

Then(
  'the {string} list opens its list timeline when clicked',
  async ({ user }, username: string, title: string) => {
    const page = pageOf(user(username).username);
    const id = listIdOf(title);
    await page.locator('[data-testid="list-item"]', { hasText: title }).locator('[data-testid="list-link"]').click();
    // The router link carries the true list id; navigating it lands on the list
    // timeline shell (the reused mastodon-timeline with the "List" heading).
    await page.waitForURL(new RegExp(`/lists/${id}(\\?|$)`), { timeout: 15_000 });
    await expect(page.locator('[data-testid="mastodon-view"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#timeline-heading')).toHaveText('List', { timeout: 15_000 });
  },
);

// ── List timeline feed ───────────────────────────────────────────────────────

When('{string} navigates to the {string} list timeline', async ({ user }, username: string, title: string) => {
  const page = pageOf(user(username).username);
  await page.goto(`/social/mastodon/lists/${listIdOf(title)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="mastodon-view"]').waitFor({ state: 'visible', timeout: 15_000 });
});

Then(
  'the {string} status appears in the {string} list timeline for {string} within {int} seconds',
  async ({ user }, tag: string, title: string, username: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const created = statusRegistry.get(tag);
    if (!created) throw new Error(`No status tagged "${tag}" was created in this scenario.`);
    const id = listIdOf(title);
    await expect
      .poll(
        async () => {
          try {
            await page.goto(`/social/mastodon/lists/${id}`, { waitUntil: 'domcontentloaded' });
            const feed = page.locator('[data-testid="mastodon-timeline"]');
            await feed.waitFor({ state: 'visible', timeout: 15_000 });
            await expect(feed).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
            return await feed.locator('[data-testid="toot-content"]', { hasText: created.text }).count();
          } catch {
            return 0;
          }
        },
        {
          message: `"${created.text}" should appear in the "${title}" list timeline for ${username} within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBeGreaterThan(0);
  },
);
