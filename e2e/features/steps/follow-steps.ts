// Follow step definitions — the account-profile follow control
// (account-profile.component.html `account-follow-btn`) driven through the
// REAL UI click (not the raw-API followViaApi seed helper other features use
// as a precondition), and its REAL consequence: the home timeline only ever
// carries posts from accounts you follow (+ yourself) — Mastodon's
// home-timeline contract — regardless of that post's own visibility, so
// following/unfollowing is the ALLOW/DENY gate on home-timeline reach.
//
// PERSONA SAFETY NOTE: this file must never make "user-b" or "user-c" follow
// "user-a" — the merged post-visibility.feature relies on user-b being an
// ACCEPTED follower and user-c being a NON-follower of user-a as load-bearing
// preconditions for its own ALLOW/DENY assertions, and follows are not undone
// between scenarios on a live stack. "locked-user" carries no such
// reservation (their domain-lock only restricts their own OUTBOUND reach, not
// who they may follow), so it is the safe actor for a UI-driven follow demo.
//
// @cluster-only; bddgen still compiles these offline.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';
import { acctFor } from '../../tests/helpers/roles';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

When('{string} navigates to the profile of {string}', async ({ user }, username: string, target: string) => {
  const page = pageOf(user(username).username);
  const acct = acctFor(user(target));
  await page.goto(`/social/mastodon/account/${encodeURIComponent(acct)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="account-profile"]').waitFor({ state: 'visible', timeout: 15_000 });
});

When('{string} clicks the follow button for {string}', async ({ user }, username: string, target: string) => {
  void target; // the button is scoped to whichever profile is currently loaded
  const page = pageOf(user(username).username);
  const btn = page.locator('[data-testid="account-follow-btn"]');
  const responsePromise = page.waitForResponse(
    (r) => /\/accounts\/[^/]+\/(un)?follow$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await btn.click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`follow/unfollow toggle for "${target}" failed: ${response.status()}`);
});

Then(
  '{string} sees the follow button labelled {string} for {string}',
  async ({ user }, username: string, label: string, target: string) => {
    void target;
    const page = pageOf(user(username).username);
    await expect(page.locator('[data-testid="account-follow-btn"]')).toHaveText(label, { timeout: 15_000 });
  },
);
