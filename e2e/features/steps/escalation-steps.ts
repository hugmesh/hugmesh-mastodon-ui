// ESCALATION-CHAIN step definitions (escalation-chain.feature) — the full
// recommend → queue → refer → decide flow across four personas.
//
// ROW IDENTITY across a live, re-run stack: the queue accumulates rows over
// runs, so "the row for instance X" is ambiguous by target alone. This run's
// row is pinned by its RUN-UNIQUE REASON: the reason field is filled with a
// uniqueMarker, the queue GET response (captured off the wire when the mod
// opens the queue) is searched for kind='instance-block' + target=instance +
// reason=<our marker>, and every later assertion addresses that row's REAL
// `mod-queue-row-{id}` testid. The rendered status CELL is the oracle for
// every transition — the API envelope alone is never trusted for a UI claim.
//
// @cluster-only; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, onScenarioReset } from './_registry';
import { SeedUser, acctFor } from '../../tests/helpers/roles';
import { uniqueMarker } from '../../tests/helpers/social';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The domain half of a persona's acct — the instance a recommendation
 *  targets. Bare local handles have NO instance: fail loudly with the fix. */
function instanceOf(user: SeedUser): string {
  const acct = acctFor(user);
  const at = acct.lastIndexOf('@');
  if (at <= 0) {
    throw new Error(
      `"${user.username}" resolves to the bare local handle "${acct}" — an instance-block ` +
        `recommendation needs a remote acct. Export E2E_${user.username.toUpperCase().replace(/-/g, '_')}_ACCT=` +
        `${user.username}@<their-host> (same precondition as the cross-domain post-visibility legs).`,
    );
  }
  return acct.slice(at + 1);
}

/** This scenario's chain state. */
const chain: {
  reason: string | null;
  rowId: number | null;
  /** The page whose open panel last loaded/refreshed the queue — the row-status
   *  assertions read THAT persona's rendered queue. */
  queuePage: Page | null;
} = { reason: null, rowId: null, queuePage: null };
// Scenario-scoped: a stale queuePage/rowId from a previous scenario would let
// the row-status assertions read a CLOSED page's queue.
onScenarioReset(() => {
  chain.reason = null;
  chain.rowId = null;
  chain.queuePage = null;
});

interface QueueRow {
  id: number;
  kind: string;
  target: string;
  reason: string | null;
  status: string;
}

When('{string} fills the actions reason with a run-unique note', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  chain.reason = `e2e-escalation ${uniqueMarker('esc-reason')}`;
  chain.rowId = null;
  const panel = page.locator('[data-testid="role-actions-panel"]').first();
  await expect(panel).toBeVisible();
  await panel.locator('[data-testid="role-actions-reason"]').fill(chain.reason);
});

When('{string} recommends an instance block from the actions panel', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const panel = page.locator('[data-testid="role-actions-panel"]').first();
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/bff/user/recommend-instance-block') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await panel.locator('[data-testid="user-recommend-instance"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`the instance-block recommendation failed: ${response.status()}`);
  const ack = (await response.json()) as { recommended?: boolean };
  expect(ack.recommended, 'the user-bff must acknowledge the recommendation').toBe(true);
});

Then(
  '{string} sees the recommendation acknowledged for the instance of {string}',
  async ({ user }, username: string, target: string) => {
    // Verbatim ok() copy: "Recommended a block of <instance> to the moderators."
    const page = pageOf(user(username).username);
    const instance = instanceOf(user(target));
    const outcome = page.locator('[data-testid="role-actions-outcome"]').first();
    await expect(outcome).toBeVisible({ timeout: 15_000 });
    await expect(outcome).toContainText(`Recommended a block of ${instance} to the moderators.`);
  },
);

When('{string} opens the moderation queue', async ({ user }, username: string) => {
  // Click Open/Refresh (same testid both states) and capture the queue GET off
  // the wire — the rows identify THIS run's request by its unique reason.
  const page = pageOf(user(username).username);
  const panel = page.locator('[data-testid="role-actions-panel"]').first();
  await expect(panel).toBeVisible();
  const responsePromise = page.waitForResponse(
    (r) => /\/bff\/mod\/moderation(\?|$)/.test(r.url()) && r.request().method() === 'GET',
    { timeout: 30_000 },
  );
  await panel.locator('[data-testid="mod-load-queue"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`loading the moderation queue failed: ${response.status()}`);
  await expect(panel.locator('[data-testid="mod-queue"]')).toBeVisible({ timeout: 15_000 });
  chain.queuePage = page;
  if (chain.rowId === null) {
    if (!chain.reason) throw new Error('No run-unique reason recorded — the recommend steps must run first.');
    const rows = (await response.json()) as QueueRow[];
    const mine = rows.filter((r) => r.kind === 'instance-block' && r.reason === chain.reason);
    if (mine.length !== 1) {
      throw new Error(
        `expected exactly ONE queue row carrying this run's reason "${chain.reason}", found ${mine.length} — ` +
          'the recommendation did not land as a queue row.',
      );
    }
    chain.rowId = mine[0].id;
  }
});

function chainRow(): { page: Page; rowId: number } {
  if (!chain.queuePage || chain.rowId === null) {
    throw new Error('The moderation queue has not been opened (with the chain row resolved) yet.');
  }
  return { page: chain.queuePage, rowId: chain.rowId };
}

Then(
  'the moderation queue row for the instance of {string} reads status {string}',
  async ({ user }, target: string, status: string) => {
    const { page, rowId } = chainRow();
    const instance = instanceOf(user(target));
    const row = page.locator(`[data-testid="mod-queue-row-${rowId}"]`);
    await expect(row, `queue row #${rowId} must be rendered`).toBeVisible({ timeout: 15_000 });
    // Belt and braces: the pinned row really targets the claimed instance…
    await expect(row.locator('.queue-target')).toHaveText(instance);
    // …and its rendered status cell reads the claimed chain state.
    await expect(row.locator('.queue-status')).toHaveText(status, { timeout: 15_000 });
  },
);

When('{string} refers that queue row to an admin', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const { rowId } = chainRow();
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes(`/bff/mod/moderation/${rowId}/refer`) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.locator(`[data-testid="mod-refer-${rowId}"]`).click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`referring row #${rowId} failed: ${response.status()}`);
  chain.queuePage = page;
});

Then('{string} sees the referral announced', async ({ user }, username: string) => {
  const { rowId } = chainRow();
  const outcome = pageOf(user(username).username).locator('[data-testid="role-actions-outcome"]').first();
  await expect(outcome).toBeVisible({ timeout: 15_000 });
  await expect(outcome).toContainText(`Referred request #${rowId} to an admin (now referred).`);
});

When('{string} approves that queue row', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const { rowId } = chainRow();
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes(`/bff/admin/moderation/${rowId}/decide`) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.locator(`[data-testid="admin-approve-${rowId}"]`).click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`approving row #${rowId} failed: ${response.status()}`);
  chain.queuePage = page;
});

Then('{string} sees the approval announced', async ({ user }, username: string) => {
  const { rowId } = chainRow();
  const outcome = pageOf(user(username).username).locator('[data-testid="role-actions-outcome"]').first();
  await expect(outcome).toBeVisible({ timeout: 15_000 });
  await expect(outcome).toContainText(`Approved request #${rowId} (now approved).`);
});
