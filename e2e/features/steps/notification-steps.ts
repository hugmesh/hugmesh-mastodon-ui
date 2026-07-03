// Notification step definitions — cross-user DELIVERY of the four
// status/relationship-driven notification types this repo's
// notifications-column.component actually renders (mention / favourite /
// reblog / follow — see NotificationsColumnComponent.verb()), the type-filter
// chips, dismiss, and clear-all.
//
// HONESTY CONTRACT:
//   - every notification asserted here is triggered by a REAL action from a
//     DIFFERENT persona than the recipient (victim-creates-first: the
//     recipient's own status is created first, then a different actor
//     mentions/favourites/boosts/follows it or them) — a pass can never be
//     explained by the recipient noticing their own activity.
//   - the "never sees" step is a DENY pair for the notification mailbox being
//     scoped to its OWNER: run only after the SAME scenario proves the
//     notification was delivered to the real recipient (the positive
//     control), then checks a bystander's mailbox never carries it.
//
// @cluster-only; bddgen still compiles these offline.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, statusRegistry } from './_registry';
import { acctFor } from '../../tests/helpers/roles';
import { postViaComposer } from './timeline-steps';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

const NOTIF_TYPES: Record<string, string> = {
  mention: 'mention',
  favourite: 'favourite',
  boost: 'reblog',
  reblog: 'reblog',
  follow: 'follow',
};

function notifType(word: string): string {
  const t = NOTIF_TYPES[word];
  if (!t) throw new Error(`Unknown notification type "${word}" — use mention | favourite | boost | follow.`);
  return t;
}

// ── Stimuli: a mention (a plain status naming another account) ──────────────

When(
  '{string} posts a "public" status mentioning {string} tagged {string}',
  async ({ user }, username: string, mentioned: string, tag: string) => {
    const page = pageOf(user(username).username);
    await postViaComposer(page, tag, 'public', `@${acctFor(user(mentioned))} `);
  },
);

// ── Observation: a status-bearing notification (mention / favourite / reblog) ─

async function findNotification(
  page: import('@playwright/test').Page,
  type: string,
  actorAcct: string,
  statusText?: string,
) {
  await page.goto('/social/mastodon/notifications', { waitUntil: 'domcontentloaded' });
  await page.locator('.notification-list').waitFor({ state: 'visible', timeout: 15_000 });
  // [data-type] lives on the notification <li> itself (notifications-column
  // component), so filter on the item's own attribute; the actor link is a
  // descendant, matched via its routerLink href.
  let items = page
    .locator(`[data-testid="notification-item"][data-type="${type}"]`)
    .filter({ has: page.locator(`a.actor[href*="/account/${encodeURIComponent(actorAcct)}"]`) });
  if (statusText) {
    items = items.filter({ has: page.locator('[data-testid="toot-content"]', { hasText: statusText }) });
  }
  return items;
}

Then(
  '{string} sees a {string} notification from {string} for the {string} status within {int} seconds',
  async ({ user }, username: string, typeWord: string, actor: string, tag: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const type = notifType(typeWord);
    const actorAcct = acctFor(user(actor));
    const text = statusRegistry.get(tag)?.text;
    if (!text) throw new Error(`No status tagged "${tag}" was created in this scenario.`);
    await expect
      .poll(async () => await findNotification(page, type, actorAcct, text).then((l) => l.count()), {
        message: `${username} should see a "${type}" notification from ${actorAcct} for "${text}" within ${seconds}s`,
        timeout: seconds * 1_000,
        intervals: [2_000, 3_000, 5_000],
      })
      .toBeGreaterThan(0);
  },
);

Then(
  '{string} sees a "follow" notification from {string} within {int} seconds',
  async ({ user }, username: string, actor: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const actorAcct = acctFor(user(actor));
    await expect
      .poll(async () => await findNotification(page, 'follow', actorAcct).then((l) => l.count()), {
        message: `${username} should see a "follow" notification from ${actorAcct} within ${seconds}s`,
        timeout: seconds * 1_000,
        intervals: [2_000, 3_000, 5_000],
      })
      .toBeGreaterThan(0);
  },
);

Then(
  '{string} never sees a {string} notification from {string} for the {string} status',
  async ({ user }, username: string, typeWord: string, actor: string, tag: string) => {
    // Post-positive-control ordering: callers must have already proven this
    // notification was delivered to its REAL recipient elsewhere in the
    // scenario. Re-checked across three real reloads.
    const page = pageOf(user(username).username);
    const type = notifType(typeWord);
    const actorAcct = acctFor(user(actor));
    const text = statusRegistry.get(tag)?.text;
    if (!text) throw new Error(`No status tagged "${tag}" was created in this scenario.`);
    for (let pass = 0; pass < 3; pass++) {
      const items = await findNotification(page, type, actorAcct, text);
      await expect(
        items,
        `${username} must never see a "${type}" notification from ${actorAcct} for "${text}" (pass ${pass + 1}/3)`,
      ).toHaveCount(0);
    }
  },
);

// ── Type filter chips ────────────────────────────────────────────────────────

When('{string} selects the {string} notification filter', async ({ user }, username: string, label: string) => {
  const page = pageOf(user(username).username);
  await page.goto('/social/mastodon/notifications', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="notifications-filter"] button', { hasText: label }).click();
});

Then('every visible notification for {string} has type {string}', async ({ user }, username: string, typeWord: string) => {
  const page = pageOf(user(username).username);
  const type = notifType(typeWord);
  const items = page.locator('[data-testid="notification-item"]');
  await expect
    .poll(async () => await items.count(), {
      message: `${username}'s filtered notification list should be non-empty (the scenario's own stimuli should have landed)`,
      timeout: 90_000,
      intervals: [3_000, 5_000],
    })
    .toBeGreaterThan(0);
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    await expect(items.nth(i), `notification #${i} should have type "${type}"`).toHaveAttribute('data-type', type);
  }
});

// ── Dismiss / clear ───────────────────────────────────────────────────────────

When(
  '{string} dismisses the notification from {string} for the {string} status',
  async ({ user }, username: string, actor: string, tag: string) => {
    const page = pageOf(user(username).username);
    const actorAcct = acctFor(user(actor));
    const text = statusRegistry.get(tag)?.text;
    if (!text) throw new Error(`No status tagged "${tag}" was created in this scenario.`);
    const items = page
      .locator('[data-testid="notification-item"]')
      .filter({ has: page.locator(`a.actor[href*="/account/${encodeURIComponent(actorAcct)}"]`) })
      .filter({ has: page.locator('[data-testid="toot-content"]', { hasText: text }) });
    await items.first().locator('[data-testid="notification-dismiss"]').click();
  },
);

When('{string} clears all notifications', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.goto('/social/mastodon/notifications', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="notifications-clear"]').click();
});

Then('{string} sees no notifications', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="notification-item"]')).toHaveCount(0);
});
