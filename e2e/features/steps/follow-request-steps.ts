// FOLLOW-REQUEST step definitions (follow-request.feature) — the locked-account
// approval flow. The lock (PATCH update_credentials) and the approval
// (POST /follow_requests/{id}/authorize) run through the TARGET'S own
// cookie-authed hsproxy session because no UI ships for either (documented
// UI-absent surfaces); the follow itself, the Requested button state and the
// follow_request notification are the real UI.
//
// @cluster-only; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';
import { acctFor } from '../../tests/helpers/roles';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

async function ensureOnOrigin(page: Page): Promise<void> {
  if (page.url() === 'about:blank') await page.goto('/', { waitUntil: 'domcontentloaded' });
}

/** Resolve an acct to its account id from `page`'s session. */
async function resolveAccountId(page: Page, acct: string): Promise<string> {
  await ensureOnOrigin(page);
  const id = await page.evaluate<string | null, string>(async (handle) => {
    const search = await fetch(
      `/bff/user/mastodon/api/v2/search?q=${encodeURIComponent(handle)}&resolve=true&type=accounts&limit=5`,
      { credentials: 'include' },
    );
    if (!search.ok) return null;
    const results = (await search.json()) as { accounts?: Array<{ id: string; acct: string; username: string }> };
    const account = (results.accounts ?? []).find(
      (a) => a.acct === handle || a.username === handle || a.acct.startsWith(`${handle}@`),
    );
    return account?.id ?? null;
  }, acct);
  if (!id) throw new Error(`could not resolve account "${acct}"`);
  return id;
}

Given('{string} sets their account locked {string} via the API', async ({ user }, username: string, locked: string) => {
  // PATCH /api/v1/accounts/update_credentials from the account's OWN session —
  // the hsproxy forwards it; the response must ECHO the requested locked state
  // (a silently-ignored lock would invalidate the whole flow).
  const page = pageOf(user(username).username);
  await ensureOnOrigin(page);
  const want = locked === 'true';
  const outcome = await page.evaluate<{ error?: string; locked?: boolean }, boolean>(async (value) => {
    const form = new FormData();
    form.append('locked', value ? 'true' : 'false');
    const res = await fetch('/bff/user/mastodon/api/v1/accounts/update_credentials', {
      method: 'PATCH',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) return { error: `update_credentials failed: ${res.status}` };
    const account = (await res.json()) as { locked?: boolean };
    return { locked: account.locked };
  }, want);
  if (outcome.error) throw new Error(`locking ${username}: ${outcome.error}`);
  expect(outcome.locked, `the server must echo locked=${want}`).toBe(want);
});

When('{string} clicks the follow button expecting a pending request', async ({ user }, username: string) => {
  // Same real UI click as follow-steps.ts, but the honest oracle differs: the
  // POST response's Relationship must read requested:true / following:false —
  // a locked target auto-accepting would falsify the whole feature.
  const page = pageOf(user(username).username);
  const btn = page.locator('[data-testid="account-follow-btn"]');
  const responsePromise = page.waitForResponse(
    (r) => /\/accounts\/[^/]+\/follow$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await btn.click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`the follow request failed: ${response.status()}`);
  const rel = (await response.json()) as { following?: boolean; requested?: boolean };
  expect(rel.requested, 'a follow of a LOCKED account must be a pending request').toBe(true);
  expect(rel.following, 'the follow must NOT be live before approval').toBe(false);
});

Then(
  '{string} sees a follow request notification from {string} within {int} seconds',
  async ({ user }, username: string, requester: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const requesterName = acctFor(user(requester)).split('@')[0];
    // The column now refreshes itself every 30s, but this poll still
    // re-navigates each pass on purpose: a fresh mount is deterministic and
    // arrives well inside the step's own budget, where waiting on the column's
    // 30s tick would make a short `within {int} seconds` bound flaky.
    await expect
      .poll(
        async () => {
          try {
            await page.goto('/social/mastodon/notifications', { waitUntil: 'domcontentloaded' });
            await page.locator('[data-testid="notifications-column"]').waitFor({ state: 'visible', timeout: 15_000 });
            return await page
              .locator('[data-testid="notification-item"]', { hasText: 'requested to follow you' })
              .filter({ hasText: new RegExp(requesterName, 'i') })
              .count();
          } catch {
            return 0;
          }
        },
        {
          message: `${username} must receive ${requester}'s follow_request notification within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBeGreaterThan(0);
  },
);

When('{string} approves the follow request from {string} via the API', async ({ user }, username: string, requester: string) => {
  // POST /api/v1/follow_requests/{account_id}/authorize from the TARGET'S own
  // session (no approval UI ships — documented gap).
  const page = pageOf(user(username).username);
  const requesterId = await resolveAccountId(page, acctFor(user(requester)));
  const status = await page.evaluate<number, string>(async (id) => {
    const res = await fetch(`/bff/user/mastodon/api/v1/follow_requests/${encodeURIComponent(id)}/authorize`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.status;
  }, requesterId);
  expect([200, 202], `authorising the follow request must succeed, got ${status}`).toContain(status);
});

Then(
  'the relationship from {string} to {string} reads following within {int} seconds',
  async ({ user }, follower: string, target: string, seconds: number) => {
    // From the REQUESTER'S side: the approval must flip requested → following.
    const page = pageOf(user(follower).username);
    const targetId = await resolveAccountId(page, acctFor(user(target)));
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
          }, targetId),
        {
          message: `${follower} → ${target} must read following:true once approved (within ${seconds}s)`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBe(true);
  },
);
