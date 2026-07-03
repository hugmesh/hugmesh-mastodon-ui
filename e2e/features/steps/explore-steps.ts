// Explore step definitions — the trending Posts / Hashtags / News tabs
// (explore.component.ts). Each tab is backed by a DISTINCT homeserver endpoint
// (GET /api/v1/trends/{statuses,tags,links}); selecting a tab must drive its own
// endpoint AND swap the rendered panel. The tab-select step arms a
// waitForResponse on that exact endpoint BEFORE the click (the same
// real-request-observation pattern search-steps' runSearch uses), so it is a
// genuine network assertion — not a content assertion (which trend appears is
// non-deterministic and deliberately NOT asserted; see explore.feature).
//
// @cluster-only (the endpoint round-trip needs the live stack); the pure
// client-side tab TOGGLE is covered offline in client-state-steps.ts. bddgen
// still compiles these offline.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

interface TabSpec {
  tab: string;
  panel: string;
  /** The `/trends/...` fragment the tab's fetch must hit. */
  endpoint: string;
}

const TABS: Record<string, TabSpec> = {
  posts: { tab: 'explore-tab-posts', panel: 'explore-panel-posts', endpoint: '/trends/statuses' },
  tags: { tab: 'explore-tab-tags', panel: 'explore-panel-tags', endpoint: '/trends/tags' },
  links: { tab: 'explore-tab-links', panel: 'explore-panel-links', endpoint: '/trends/links' },
};

function tabSpec(word: string): TabSpec {
  const spec = TABS[word];
  if (!spec) throw new Error(`Unknown trending tab "${word}" — use posts | tags | links.`);
  return spec;
}

When(
  '{string} selects the {string} trending tab and its trends endpoint responds',
  async ({ user }, username: string, word: string) => {
    const page = pageOf(user(username).username);
    const spec = tabSpec(word);
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes(spec.endpoint) && r.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.locator(`[data-testid="${spec.tab}"]`).click();
    const response = await responsePromise;
    if (!response.ok()) {
      throw new Error(`the "${word}" tab's ${spec.endpoint} request failed: ${response.status()}`);
    }
  },
);

Then('{string} sees the {string} trending panel', async ({ user }, username: string, word: string) => {
  const page = pageOf(user(username).username);
  const spec = tabSpec(word);
  // The selected tab is pressed AND its (and only its) panel is rendered — the
  // *ngIf on tab() gates the panels, so a wrong-tab panel is absent, not hidden.
  await expect(page.locator(`[data-testid="${spec.tab}"]`)).toHaveAttribute('aria-pressed', 'true', {
    timeout: 15_000,
  });
  await expect(page.locator(`[data-testid="${spec.panel}"]`)).toBeVisible({ timeout: 15_000 });
});
