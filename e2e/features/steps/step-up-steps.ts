// Offline step definitions for mod-block-step-up-offline.feature — the
// server-wide block when mod-bff-api answers 403 + X-Step-Up-Required.
//
// HONESTY NOTES:
//   - the 403 + header are produced by a page.route stub of POST /bff/mod/block,
//     the exact wire shape mod-bff-api's ModController documents;
//   - "the login remote entry is stubbed as absent" answers 404 for
//     /login/remoteEntry.json and COUNTS the requests, so the plain-403
//     scenario can assert the remote was never even asked for;
//   - the assertions read the menu's REAL outcome live region and the real
//     buttons; the post-count comes off the stub.

import { expect, Page } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { onScenarioReset, pageRegistry } from './_registry';

const wire = { blockPosts: 0, remoteEntryGets: 0 };
onScenarioReset(() => {
  wire.blockPosts = 0;
  wire.remoteEntryGets = 0;
});

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

Given('the server-wide block is stubbed to demand a step-up', async ({ page }) => {
  await page.route('**/bff/mod/block', (route) => {
    wire.blockPosts += 1;
    void route.fulfill({
      status: 403,
      contentType: 'text/plain',
      headers: { 'X-Step-Up-Required': 'mod-bff' },
      body: 'requires step-up',
    });
  });
});

Given('the server-wide block is stubbed to refuse on role', async ({ page }) => {
  await page.route('**/bff/mod/block', (route) => {
    wire.blockPosts += 1;
    void route.fulfill({ status: 403, contentType: 'text/plain', body: 'Forbidden' });
  });
});

Given('the login remote entry is stubbed as absent', async ({ page }) => {
  await page.route('**/login/remoteEntry.json', (route) => {
    wire.remoteEntryGets += 1;
    void route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
  });
});

When('{string} requests a server-wide user block', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="mod-block-user"]').first().click();
});

Then('the block outcome reads {string} as an alert', async ({ page }, text: string) => {
  const outcome = page.locator('[data-testid="role-actions-outcome"]').first();
  await expect(outcome).toContainText(text, { timeout: 15_000 });
  await expect(outcome).toHaveAttribute('role', 'alert');
});

Then('the server-wide block was posted {int} time(s)', async ({}, n: number) => {
  expect(wire.blockPosts).toBe(n);
});

Then('the login remote entry was requested {int} time(s)', async ({}, n: number) => {
  expect(wire.remoteEntryGets).toBe(n);
});

Then('the server-wide block buttons are enabled again', async ({ page }) => {
  await expect(page.locator('[data-testid="mod-block-user"]').first()).toBeEnabled({ timeout: 10_000 });
});
