// Offline create-list step definitions — the create control on the lists index
// (lists-index.component.*). Like client-state-steps.ts these run against the
// remote's dev-shell (root /lists route) with NO live stack, and reuse its
// `Given a visitor opens the {word} standalone page` navigation.
//
// The pure empty-title guard needs no backend (the disabled binding reads a
// signal synchronously). The add / reject scenarios STUB the create response
// with page.route on the same-origin hsproxy path the dev-shell service targets
// by default (BFF_BASE_URL '' + proxy on → /bff/user/mastodon), so the
// submit → POST → append (or → announced error) wiring is proven offline. The
// GET on init is stubbed to [] too so the index starts deterministically empty
// regardless of what `ng serve` returns for that path.

import { expect, Page, Route } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';

const LISTS_API = '**/bff/user/mastodon/api/v1/lists';

const input = (page: Page) => page.locator('[data-testid="list-create-input"]');
const submit = (page: Page) => page.locator('[data-testid="list-create-submit"]');
const listRow = (page: Page, title: string) => page.locator('[data-testid="list-item"]', { hasText: title });

/** Route the lists endpoint: the GET (init) always yields [] so the index starts
 *  empty; the POST is handled by `onCreate`. Armed BEFORE navigation so both the
 *  init fetch and the create are deterministic with no homeserver. */
async function stubListsApi(page: Page, onCreate: (route: Route) => Promise<void>): Promise<void> {
  await page.route(LISTS_API, async (route) => {
    if (route.request().method() === 'POST') return onCreate(route);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

// ── Backend stubs (offline: no live homeserver) ──────────────────────────────

Given('the create-list API will accept new lists', async ({ page }) => {
  // Echo the POSTed title back as a server-confirmed list with a real-shaped id,
  // exactly as the homeserver would, so the append path stores a true row.
  await stubListsApi(page, async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { title?: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: `stub-${Date.now()}`, title: body.title ?? '', replies_policy: 'list' }),
    });
  });
});

Given('the create-list API will reject new lists', async ({ page }) => {
  await stubListsApi(page, async (route) => {
    await route.fulfill({ status: 422, contentType: 'application/json', body: '{"error":"rejected"}' });
  });
});

// ── Form interaction ─────────────────────────────────────────────────────────

When('the visitor types {string} into the new-list title', async ({ page }, title: string) => {
  await input(page).fill(title);
});

When('the visitor clears the new-list title', async ({ page }) => {
  await input(page).fill('');
});

When('the visitor submits the new-list form', async ({ page }) => {
  await submit(page).click();
});

// ── Assertions ───────────────────────────────────────────────────────────────

Then('the create-list submit is disabled', async ({ page }) => {
  await expect(submit(page)).toBeDisabled({ timeout: 10_000 });
});

Then('the create-list submit is enabled', async ({ page }) => {
  await expect(submit(page)).toBeEnabled({ timeout: 10_000 });
});

Then('the {string} list appears in the lists index', async ({ page }, title: string) => {
  const row = listRow(page, title);
  await expect(row).toHaveCount(1, { timeout: 10_000 });
  await expect(row.locator('[data-testid="list-link"]')).toHaveText(title, { timeout: 10_000 });
});

Then('the new-list title is cleared', async ({ page }) => {
  await expect(input(page)).toHaveValue('', { timeout: 10_000 });
});

Then('the create-list error is shown', async ({ page }) => {
  await expect(page.locator('[data-testid="list-create-error"]')).toBeVisible({ timeout: 10_000 });
});

Then('the {string} list is not in the lists index', async ({ page }, title: string) => {
  await expect(listRow(page, title)).toHaveCount(0, { timeout: 10_000 });
});
