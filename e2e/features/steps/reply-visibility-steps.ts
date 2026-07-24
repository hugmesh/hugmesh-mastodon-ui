// REPLY-VISIBILITY-INHERITANCE step definitions
// (reply-visibility-inheritance.feature) — gates the fixed HIGH defect where
// the thread-view reply composer defaulted a private/direct thread's reply to
// Public. The oracle stack: real <select> value on the mounted thread view →
// the reply's own POST response (visibility + threading) → the thread
// descendants list → the signed-out public-timeline DENY.
//
// @cluster-only; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, statusRegistry, CreatedStatus, onScenarioReset } from './_registry';
import { uniqueMarker } from '../../tests/helpers/social';

function pageOf(username: string): Page {
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

/** The reply envelopes this scenario captured, keyed by tag. */
const replyEnvelopes = new Map<string, { visibility: string | null; inReplyToId: string | null }>();
onScenarioReset(() => replyEnvelopes.clear());

When('{string} opens the thread view of the {string} status', async ({ user }, username: string, tag: string) => {
  const created = statusOf(tag);
  if (!created.id) throw new Error(`status "${tag}" has no captured id — the posting step must capture it.`);
  const page = pageOf(user(username).username);
  await page.goto(`/social/mastodon/status/${created.id}`, { waitUntil: 'domcontentloaded' });
  const focused = page.locator('[data-testid="status-focused"]');
  await expect(focused).toBeVisible({ timeout: 15_000 });
  await expect(focused.locator('[data-testid="toot-content"]')).toContainText(created.text, { timeout: 15_000 });
});

Then('the thread reply composer visibility reads {string} for {string}', async ({ user }, visibility: string, username: string) => {
  // THE regression assertion: the reply composer mounted under the thread view
  // must inherit the PARENT's visibility — before the fix this select read
  // "public" for a private/direct parent.
  const page = pageOf(user(username).username);
  const select = page.locator('[data-testid="status-reply-box"] [data-testid="compose-visibility"]');
  await expect(select).toBeVisible({ timeout: 15_000 });
  await expect(select).toHaveValue(visibility);
});

When('{string} posts the thread reply tagged {string}', async ({ user }, username: string, tag: string) => {
  // Post through the thread-view composer AS PRESET — the step deliberately
  // never touches the visibility select, so what lands is what inheritance
  // chose.
  const page = pageOf(user(username).username);
  const box = page.locator('[data-testid="status-reply-box"]');
  const text = uniqueMarker(tag);
  await box.locator('[data-testid="mastodon-input"]').fill(text);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await box.locator('[data-testid="mastodon-post"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`posting the "${tag}" thread reply failed: ${response.status()}`);
  const body = (await response.json()) as { id?: string; visibility?: string; in_reply_to_id?: string };
  statusRegistry.set(tag, { text, id: body.id ?? null, visibility: body.visibility ?? null });
  replyEnvelopes.set(tag, { visibility: body.visibility ?? null, inReplyToId: body.in_reply_to_id ?? null });
});

Then('the captured {string} reply is private and threaded to {string}', async ({}, tag: string, parentTag: string) => {
  const envelope = replyEnvelopes.get(tag);
  if (!envelope) throw new Error(`No captured reply envelope for "${tag}".`);
  const parent = statusOf(parentTag);
  expect(envelope.visibility, 'the inherited reply must have posted PRIVATE — Public here is the leak').toBe('private');
  expect(envelope.inReplyToId, 'the reply must be threaded to its parent').toBe(parent.id);
});

Then('{string} sees the {string} status among the thread descendants', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  await expect(
    page.locator('[data-testid="status-descendants"] [data-testid="toot-content"]', {
      hasText: statusOf(tag).text,
    }),
  ).toBeVisible({ timeout: 15_000 });
});
