// Direct-message / Conversations step definitions — the DirectTimeline surface
// (conversations-column.component.ts, GET /api/v1/conversations) and its inline
// direct-visibility reply composer. Extends the post-visibility wave's honesty
// contract to the RECIPIENT'S conversation mailbox:
//
//   - the ALLOW ("appears in the conversations of X") already exists in
//     timeline-steps.ts; this file adds the SENDER-attribution assertion (the
//     conversation carries an author link to the real sender, not just the
//     marker text) and the mailbox-scoping DENY (an un-addressed bystander's
//     Conversations never carries it — re-checked across real reloads, only
//     honest after the positive control above proved delivery).
//   - the reply is a REAL child status: the step captures the POST response and
//     refuses to believe it unless visibility=direct AND in_reply_to_id links
//     it to the parent, then it is observed landing in the sender's own
//     Conversations (the reciprocal ALLOW).
//
// @cluster-only; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
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

const DIRECT_PATH = '/social/mastodon/direct';

/** Navigate to the Conversations column and wait for it to render. */
async function openConversations(page: Page): Promise<void> {
  await page.goto(DIRECT_PATH, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="conversations-column"]').waitFor({ state: 'visible', timeout: 15_000 });
}

/** The conversation row carrying `text` (the direct status' unique marker). */
function conversationWithText(page: Page, text: string) {
  return page.locator('[data-testid="conversation-item"]', { hasText: text });
}

// ── Sender attribution (the conversation carries the real sender) ────────────

Then(
  '{string} sees the {string} conversation attributed to {string}',
  async ({ user }, username: string, tag: string, sender: string) => {
    const page = pageOf(user(username).username);
    const text = statusOf(tag).text;
    const senderAcct = acctFor(user(sender));
    await openConversations(page);
    // The row must both carry the marker AND embed an author link to the real
    // sender's account (the last_status toot-card author link) — proving who
    // the conversation is with, not merely that some row mentions the marker.
    const attributed = conversationWithText(page, text).filter({
      has: page.locator(`a[href*="/account/${encodeURIComponent(senderAcct)}"]`),
    });
    await expect(attributed).toHaveCount(1, { timeout: 15_000 });
  },
);

// ── Mailbox-scoping DENY (an un-addressed bystander never receives it) ───────

Then(
  'the {string} status never appears in the conversations of {string}',
  async ({ user }, tag: string, username: string) => {
    // Post-positive-control ordering: only honest AFTER the same scenario proved
    // the direct status DID reach its real addressee. A `direct` status is
    // addressed to its mentioned accounts only, so an un-addressed bystander's
    // Conversations must never carry it — re-checked across three real reloads.
    const page = pageOf(user(username).username);
    const text = statusOf(tag).text;
    for (let pass = 0; pass < 3; pass++) {
      await openConversations(page);
      await expect(
        conversationWithText(page, text),
        `"${text}" must never appear in ${username}'s conversations (pass ${pass + 1}/3)`,
      ).toHaveCount(0);
    }
  },
);

// ── Private reply from within the conversation ───────────────────────────────

When(
  '{string} replies privately to the {string} conversation tagged {string}',
  async ({ user }, username: string, parentTag: string, replyTag: string) => {
    const parent = statusOf(parentTag);
    if (!parent.id) throw new Error(`status "${parentTag}" has no captured id — the posting step must capture it.`);
    const page = pageOf(user(username).username);
    await openConversations(page);

    const row = conversationWithText(page, parent.text).first();
    await row.waitFor({ state: 'visible', timeout: 15_000 });

    // Expand the inline reply composer (its aria-expanded is the real toggle
    // state) — the composer is *ngIf-gated on it, so this must flip true.
    const toggle = row.locator('[data-testid="conversation-reply-toggle"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });

    const composer = row.locator('.conversation-reply');
    await composer.waitFor({ state: 'visible', timeout: 5_000 });

    const text = uniqueMarker(replyTag);
    await composer.locator('[data-testid="mastodon-input"]').fill(text);
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await composer.locator('[data-testid="mastodon-post"]').click();
    const response = await responsePromise;
    if (!response.ok()) throw new Error(`posting the private reply "${replyTag}" failed: ${response.status()}`);
    const body = (await response.json()) as { id?: string; visibility?: string; in_reply_to_id?: string };
    // Honest oracle: the composer is pre-set to `direct` and threaded to the
    // parent — the server must have honoured BOTH or the reply is not the
    // private reply the scenario claims.
    expect(body.visibility, 'a private reply must post with direct visibility').toBe('direct');
    expect(body.in_reply_to_id, 'the reply must be threaded to the conversation parent').toBe(parent.id);
    statusRegistry.set(replyTag, { text, id: body.id ?? null, visibility: body.visibility ?? null });
  },
);
