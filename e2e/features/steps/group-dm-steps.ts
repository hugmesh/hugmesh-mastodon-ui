// GROUP direct-message step definitions (direct-messages-group.feature) —
// three-participant DM delivery and the mention-based-reach honesty trap.
//
// Mastodon addressing model: a `direct` status reaches EXACTLY its mentioned
// accounts. These steps compose through the real UI with the mention list AS
// the addressing, capture the POST response (visibility must be 'direct'), and
// let the shared conversation-observation steps (timeline-steps.ts /
// direct-message-steps.ts) prove or deny delivery per persona.
//
// @cluster-only; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { When } from '../support/fixtures';
import { pageRegistry, statusRegistry, CreatedStatus } from './_registry';
import { acctFor } from '../../tests/helpers/roles';
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

/** Compose a direct status on the CURRENT page addressing `mentions`, capture
 *  the POST, and register the marker + id under `tag`. */
async function postDirectTo(page: Page, mentions: string[], tag: string): Promise<void> {
  const text = `${mentions.map((m) => `@${m}`).join(' ')} ${uniqueMarker(tag)}`;
  await page.locator('[data-testid="compose-visibility"]').selectOption('direct');
  await page.locator('[data-testid="mastodon-input"]').fill(text);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.locator('[data-testid="mastodon-post"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`posting the "${tag}" group DM failed: ${response.status()}`);
  const body = (await response.json()) as {
    id?: string;
    visibility?: string;
    mentions?: Array<{ acct?: string }>;
  };
  expect(body.visibility, 'a group DM must post with direct visibility').toBe('direct');
  // The addressing must have RESOLVED: every intended handle appears in the
  // server-parsed mention list — an unresolved handle would silently narrow
  // the audience and invalidate the delivery claims that follow.
  const resolved = (body.mentions ?? []).map((m) => m.acct ?? '');
  for (const handle of mentions) {
    const local = handle.split('@')[0];
    expect(
      resolved.some((a) => a === handle || a === local || a.startsWith(`${local}@`)),
      `the server must resolve the @${handle} mention (got: ${resolved.join(', ') || 'none'})`,
    ).toBe(true);
  }
  // The marker (without the mention prefix) is the observation oracle.
  const marker = text.slice(text.lastIndexOf(' ') + 1);
  statusRegistry.set(tag, { text: marker, id: body.id ?? null, visibility: body.visibility ?? null });
}

When(
  '{string} posts a direct status to {string} and {string} tagged {string}',
  async ({ user }, username: string, first: string, second: string, tag: string) => {
    const page = pageOf(user(username).username);
    await postDirectTo(page, [acctFor(user(first)), acctFor(user(second))], tag);
  },
);

/** Reply inside the conversation row for `parentTag` with an explicit mention
 *  list — the conversation composer posts with direct visibility; the mentions
 *  in the text ARE the reply's audience. */
async function replyWithMentions(
  page: Page,
  parentTag: string,
  mentions: string[],
  replyTag: string,
): Promise<void> {
  const parent = statusOf(parentTag);
  await page.goto('/social/mastodon/direct', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="conversations-column"]').waitFor({ state: 'visible', timeout: 15_000 });
  const row = page.locator('[data-testid="conversation-item"]', { hasText: parent.text }).first();
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  const toggle = row.locator('[data-testid="conversation-reply-toggle"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });
  const composer = row.locator('.conversation-reply');
  const marker = uniqueMarker(replyTag);
  await composer.locator('[data-testid="mastodon-input"]').fill(`${mentions.map((m) => `@${m}`).join(' ')} ${marker}`);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await composer.locator('[data-testid="mastodon-post"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`the "${replyTag}" group reply failed: ${response.status()}`);
  const body = (await response.json()) as { id?: string; visibility?: string; in_reply_to_id?: string };
  expect(body.visibility, 'a conversation reply must post with direct visibility').toBe('direct');
  expect(body.in_reply_to_id, 'the reply must be threaded into the conversation').toBeTruthy();
  statusRegistry.set(replyTag, { text: marker, id: body.id ?? null, visibility: body.visibility ?? null });
}

When(
  '{string} replies to the group conversation {string} keeping mentions of {string} and {string} tagged {string}',
  async ({ user }, username: string, parentTag: string, first: string, second: string, replyTag: string) => {
    const page = pageOf(user(username).username);
    await replyWithMentions(page, parentTag, [acctFor(user(first)), acctFor(user(second))], replyTag);
  },
);

When(
  '{string} replies to the group conversation {string} mentioning only {string} tagged {string}',
  async ({ user }, username: string, parentTag: string, only: string, replyTag: string) => {
    // The NARROWING leg: the dropped participant is deliberately absent from
    // the mention list, so Mastodon's mention-based direct reach must exclude
    // them — the feature's DENY step observes exactly that.
    const page = pageOf(user(username).username);
    await replyWithMentions(page, parentTag, [acctFor(user(only))], replyTag);
  },
);
