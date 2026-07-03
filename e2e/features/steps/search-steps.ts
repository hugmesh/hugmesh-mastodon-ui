// Search step definitions — cross-user DISCOVERY through the real
// /api/v2/search (search.component.ts), scoped to what is reliably indexed on
// EVERY Mastodon/Akkoma deployment regardless of optional full-text-search
// backends:
//   - an EXACT account handle always resolves (webfinger-style lookup).
//   - a hashtag used in a real post is always indexed (the Tag table, not
//     dependent on an ElasticSearch-style content index).
// Free-text STATUS-content search is deliberately NOT covered here — Mastodon
// (unlike Akkoma) only full-text-indexes statuses for search when an optional
// ElasticSearch backend is configured, and this wave cannot verify that
// backend is present on every target deployment; asserting it would risk an
// environment-dependent false claim. See the PR description for this
// disclosed gap.
//
// @cluster-only; bddgen still compiles these offline.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';
import { acctFor } from '../../tests/helpers/roles';
import { uniqueHashtag } from '../../tests/helpers/social';
import { postViaComposer } from './timeline-steps';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** feature-facing hashtag LABEL → the real run-unique hashtag word posted for
 *  it, so the searching step greps for the exact tag this scenario created
 *  (never a fabricated/static one that could collide across runs/retries). */
const hashtagRegistry = new Map<string, string>();

// ── Stimulus: a real public post carrying a hashtag ─────────────────────────

When(
  '{string} posts a "public" status tagged {string} with the hashtag {string}',
  async ({ user }, username: string, tag: string, label: string) => {
    const page = pageOf(user(username).username);
    const hashtag = uniqueHashtag(label);
    hashtagRegistry.set(label, hashtag);
    await postViaComposer(page, tag, 'public', `#${hashtag} `);
  },
);

async function runSearch(page: import('@playwright/test').Page, query: string): Promise<void> {
  if (page.url() === 'about:blank' || !page.url().includes('/social/mastodon/search')) {
    await page.goto('/social/mastodon/search', { waitUntil: 'domcontentloaded' });
  }
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v2/search') && r.request().method() === 'GET',
    { timeout: 15_000 },
  );
  await page.locator('[data-testid="search-input"]').fill(query);
  await responsePromise;
}

function hashtagFor(label: string): string {
  const hashtag = hashtagRegistry.get(label);
  if (!hashtag) throw new Error(`No hashtag labelled "${label}" was posted in this scenario.`);
  return hashtag;
}

When(
  '{string} searches for the mastodon handle of {string}',
  async ({ user }, username: string, target: string) => {
    const page = pageOf(user(username).username);
    await runSearch(page, acctFor(user(target)));
  },
);

When('{string} searches for the {string} hashtag', async ({ user }, username: string, label: string) => {
  const page = pageOf(user(username).username);
  await runSearch(page, `#${hashtagFor(label)}`);
});

Then(
  '{string} sees {string} in the People search results within {int} seconds',
  async ({ user }, username: string, target: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const handle = acctFor(user(target));
    const row = page.locator('[data-testid="search-results-accounts"] .account-row', { hasText: `@${handle}` });
    await expect(row).toBeVisible({ timeout: seconds * 1_000 });
  },
);

Then(
  '{string} sees the {string} hashtag in the Hashtags search results within {int} seconds',
  async ({ user }, username: string, label: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const hashtag = hashtagFor(label);
    const row = page.locator('[data-testid="search-results-hashtags"] .hashtag-row', { hasText: `#${hashtag}` });
    await expect(row).toBeVisible({ timeout: seconds * 1_000 });
  },
);

When('{string} selects the {string} search type', async ({ user }, username: string, type: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="search-type-filter"] button', { hasText: type }).first().click();
});

Then('{string} sees only the {string} search section', async ({ user }, username: string, section: string) => {
  const page = pageOf(user(username).username);
  const sections = ['accounts', 'hashtags', 'statuses'];
  for (const s of sections) {
    const locator = page.locator(`[data-testid="search-results-${s}"]`);
    if (s === section) {
      await expect(locator).toBeVisible();
    } else {
      // showSection() gates these sections with *ngIf, so an out-of-scope
      // section is not merely hidden — it never renders at all.
      await expect(locator).toHaveCount(0);
    }
  }
});
