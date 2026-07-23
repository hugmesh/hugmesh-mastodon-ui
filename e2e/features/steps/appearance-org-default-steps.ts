// ADMIN ORG-DEFAULT step definitions (appearance-org-default.feature) — the
// cross-user admin appearance default and its non-customised-user adoption.
//
// The admin write is the REAL admin-set-default click, believed off its
// PUT /bff/admin/mastodon/appearance-default response AND the announced
// live-region copy (PreferencesService.setOrgDefault →
// AppearancePanelComponent.setAsDefaultForEveryone). Adoption is read from the
// OTHER persona's mastodon-view root (data-mastodon-theme), which
// PreferencesService.loadOrgBffDefault stamps on load for a non-customised
// caller. All @cluster; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

const root = (page: Page) => page.locator('[data-testid="mastodon-view"]');

async function openPanel(page: Page): Promise<void> {
  const trigger = page.locator('[data-testid="appearance-trigger"]');
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  if ((await page.locator('[data-testid="appearance-panel"]').count()) === 0) {
    await trigger.click();
  }
  await expect(page.locator('[data-testid="appearance-panel"]')).toBeVisible({ timeout: 10_000 });
}

When('{string} opens the appearance panel', async ({ user }, username: string) => {
  await openPanel(pageOf(user(username).username));
});

When('{string} selects the {string} theme in the appearance panel', async ({ user }, username: string, theme: string) => {
  // The panel must be open (a preceding step opens it once; re-opening after the
  // admin's own theme took effect is a no-op the helper guards).
  const page = pageOf(user(username).username);
  await openPanel(page);
  await page.locator(`[data-testid="theme-${theme}"]`).click();
  // The applied theme is stamped on the remote root immediately (the local
  // apply() runs before any durable sync) — assert it so a later org-default
  // save provably carries THIS theme.
  await expect(root(page)).toHaveAttribute('data-mastodon-theme', theme, { timeout: 10_000 });
});

When('{string} sets the current appearance as the default for everyone', async ({ user }, username: string) => {
  // admin-set-default → PreferencesService.setOrgDefault(snapshot) →
  // PUT /bff/admin/mastodon/appearance-default. Believed off the wire: a failed
  // durable write is surfaced on syncError (announced), never a silent no-op.
  const page = pageOf(user(username).username);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/bff/admin/mastodon/appearance-default') && r.request().method() === 'PUT',
    { timeout: 30_000 },
  );
  await page.locator('[data-testid="admin-set-default"]').click();
  const response = await responsePromise;
  if (![200, 202, 204].includes(response.status())) {
    throw new Error(`the org-default PUT was rejected: ${response.status()}`);
  }
});

Then('{string} sees the org-default-saved announcement', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // Verbatim setAsDefaultForEveryone() copy in the polite live region.
  await expect(page.locator('[data-testid="appearance-live"]')).toContainText(
    'Saved the current appearance as the default for everyone',
    { timeout: 10_000 },
  );
});

Then(
  'the remote root for {string} carries data-mastodon-theme {string} within {int} seconds',
  async ({ user }, username: string, theme: string, seconds: number) => {
    // Re-navigate each poll tick so eventual consistency of the brand-wide write
    // is tolerated: loadOrgBffDefault runs on every fresh load and (for a
    // non-customised caller) adopts the configured default.
    const page = pageOf(user(username).username);
    await expect
      .poll(
        async () => {
          try {
            await page.goto('/social/mastodon', { waitUntil: 'domcontentloaded' });
            await root(page).waitFor({ state: 'visible', timeout: 15_000 });
            return await root(page).getAttribute('data-mastodon-theme');
          } catch {
            return null;
          }
        },
        {
          message: `${username}'s remote root must read data-mastodon-theme="${theme}" within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBe(theme);
  },
);

Then(
  'the remote root for {string} carries data-mastodon-theme {string} without reloading',
  async ({ user }, username: string, theme: string) => {
    await expect(root(pageOf(user(username).username))).toHaveAttribute('data-mastodon-theme', theme, {
      timeout: 10_000,
    });
  },
);

When('{string} resets their own appearance to default', async ({ user }, username: string) => {
  // Restore user-c's per-user prefs so the isolation scenario leaves no durable
  // customisation behind (appearance-reset → PreferencesService.resetToDefault).
  const page = pageOf(user(username).username);
  await openPanel(page);
  await page.locator('[data-testid="appearance-reset"]').click();
});
