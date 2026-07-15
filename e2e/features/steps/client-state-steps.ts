// Offline / client-side step definitions — pure signal-driven UI state that
// renders and transitions with NO backend. These drive the remote's dev-shell
// (app.routes.ts mounts the exposed routes at the root), so they navigate the
// ROOT paths (/explore, /search, …) rather than the host mount (/social/...),
// and are meant to run against `ng serve` with E2E_BASE_URL pointed at it (the
// default no-cluster config already selects the untagged @client-state
// scenarios). No session is seeded — the dev-shell routes carry no guard, so a
// "visitor" reaches them directly, and every assertion is a REAL state
// transition (aria-pressed flip + the DOM panel/section it gates, or a rendered
// empty state) that FAILS against a blank page.
//
// The controls set an Angular signal synchronously, so the pressed-state + panel
// swap do not depend on the component's init fetch resolving — the list-
// returning service methods fall back to [] on any absent/non-OK backend.

import { expect, Page } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';

interface StandalonePage {
  path: string;
  root: string;
}

const PAGES: Record<string, StandalonePage> = {
  Explore: { path: '/explore', root: 'explore-view' },
  Search: { path: '/search', root: 'search-view' },
  Notifications: { path: '/notifications', root: 'notifications-column' },
  Lists: { path: '/lists', root: 'lists-index' },
  Direct: { path: '/direct', root: 'conversations-column' },
  // The home timeline: carries the appearance panel (header gear) + the main
  // compose box — the chat-theme sweep and offline recorder features drive it.
  Home: { path: '/', root: 'mastodon-view' },
};

function pageSpec(name: string): StandalonePage {
  const spec = PAGES[name];
  if (!spec) throw new Error(`Unknown standalone page "${name}" — use ${Object.keys(PAGES).join(' | ')}.`);
  return spec;
}

/** Explore tab word → its tab-button + panel testids. */
const EXPLORE_TABS: Record<string, { tab: string; panel: string }> = {
  posts: { tab: 'explore-tab-posts', panel: 'explore-panel-posts' },
  tags: { tab: 'explore-tab-tags', panel: 'explore-panel-tags' },
  links: { tab: 'explore-tab-links', panel: 'explore-panel-links' },
};

function exploreTab(word: string): { tab: string; panel: string } {
  const spec = EXPLORE_TABS[word];
  if (!spec) throw new Error(`Unknown trending tab "${word}" — use posts | tags | links.`);
  return spec;
}

/** A filter/type button located by its exact visible label inside a named
 *  filter nav (the search type-filter + notification filter chips expose no
 *  per-button testid, only the nav container does). */
function labelledButton(page: Page, navTestid: string, label: string) {
  return page.locator(`[data-testid="${navTestid}"] button`, { hasText: new RegExp(`^${label}$`, 'i') });
}

// ── Navigation (dev-shell root routes, no session) ───────────────────────────

Given('a visitor opens the {word} standalone page', async ({ page }, name: string) => {
  const spec = pageSpec(name);
  await page.goto(spec.path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`[data-testid="${spec.root}"]`)).toBeVisible({ timeout: 15_000 });
});

// ── Explore tabs (aria-pressed + the panel it gates) ─────────────────────────

When('the visitor switches to the {string} trending tab', async ({ page }, word: string) => {
  await page.locator(`[data-testid="${exploreTab(word).tab}"]`).click();
});

Then('the {string} trending tab is pressed', async ({ page }, word: string) => {
  await expect(page.locator(`[data-testid="${exploreTab(word).tab}"]`)).toHaveAttribute('aria-pressed', 'true', {
    timeout: 10_000,
  });
});

Then('the {string} trending tab is not pressed', async ({ page }, word: string) => {
  await expect(page.locator(`[data-testid="${exploreTab(word).tab}"]`)).toHaveAttribute('aria-pressed', 'false', {
    timeout: 10_000,
  });
});

Then('the {string} trending panel is shown', async ({ page }, word: string) => {
  await expect(page.locator(`[data-testid="${exploreTab(word).panel}"]`)).toBeVisible({ timeout: 10_000 });
});

// ── Search type filter ───────────────────────────────────────────────────────

When('the visitor picks the {string} search type', async ({ page }, label: string) => {
  await labelledButton(page, 'search-type-filter', label).click();
});

Then('the {string} search type is pressed', async ({ page }, label: string) => {
  await expect(labelledButton(page, 'search-type-filter', label)).toHaveAttribute('aria-pressed', 'true', {
    timeout: 10_000,
  });
});

Then('the {string} search type is not pressed', async ({ page }, label: string) => {
  await expect(labelledButton(page, 'search-type-filter', label)).toHaveAttribute('aria-pressed', 'false', {
    timeout: 10_000,
  });
});

// ── Notification filter chips ────────────────────────────────────────────────

When('the visitor picks the {string} notification filter', async ({ page }, label: string) => {
  await labelledButton(page, 'notifications-filter', label).click();
});

Then('the {string} notification filter is pressed', async ({ page }, label: string) => {
  await expect(labelledButton(page, 'notifications-filter', label)).toHaveAttribute('aria-pressed', 'true', {
    timeout: 10_000,
  });
});

Then('the {string} notification filter is not pressed', async ({ page }, label: string) => {
  await expect(labelledButton(page, 'notifications-filter', label)).toHaveAttribute('aria-pressed', 'false', {
    timeout: 10_000,
  });
});

// ── Lists empty state ────────────────────────────────────────────────────────

Then('the lists index shows its no-lists empty state', async ({ page }) => {
  await expect(page.locator('[data-testid="lists-index"] .empty')).toHaveText('You have no lists yet.', {
    timeout: 10_000,
  });
});
