// SELF-BLOCK CONSEQUENCE step definitions (self-block-consequences.feature) —
// the observable effects of the USER-tier 'mastodon'-platform self-block, in
// both directions. Complements self-block-steps.ts (which pins the
// deterministic 'internal' disclosure): here the EXTERNAL leg is exercised and
// its truth is proven by consequences, not by the click.
//
//   - the disclosure step accepts any REAL envelope state the UI relays
//     verbatim (ok | stubbed | degraded | n/a) — what it forbids is silence or
//     an unqualified bare success;
//   - the relationship severance is polled off the REAL
//     GET /accounts/relationships from the BLOCKED side's own session (the
//     reverse-direction oracle);
//   - timeline disappearance / never-appears reuse the shared honest helpers
//     (positive control first, bounded polls, no sleeps).
//
// @cluster-only; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { Then } from '../support/fixtures';
import { pageRegistry } from './_registry';
import { acctFor } from '../../tests/helpers/roles';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

Then('{string} sees the safety outcome disclosing the external push state', async ({ user }, username: string) => {
  // RoleActionsMenuComponent.blockUser() renders the user-bff ack VERBATIM:
  // "Blocked @<acct> (mastodon). External push: <state>." The state may
  // honestly be ok / stubbed / degraded:… / n/a depending on the deployment's
  // block.mastodon.enabled flag — the point is the user is TOLD the real leg
  // state. Whether the leg landed is proven by the consequence steps after
  // this one; a disclosed 'ok' without the observed disappearance still fails
  // the scenario.
  const page = pageOf(user(username).username);
  const outcome = page.locator('[data-testid="role-actions-outcome"]').first();
  await expect(outcome).toBeVisible({ timeout: 15_000 });
  await expect(outcome).toContainText(/External push: (ok|stubbed|degraded|n\/a)/i);
});

Then(
  'the relationship from {string} to {string} reads not-following within {int} seconds',
  async ({ user }, follower: string, target: string, seconds: number) => {
    // Read from the FOLLOWER'S OWN session (the blocked side): resolve the
    // target account, then poll the real Relationship until following:false.
    // A block that never severs keeps following:true and honestly fails here.
    const page = pageOf(user(follower).username);
    const targetAcct = acctFor(user(target));
    if (page.url() === 'about:blank') await page.goto('/', { waitUntil: 'domcontentloaded' });

    const targetId = await page.evaluate<string | null, string>(async (acct) => {
      const search = await fetch(
        `/bff/user/mastodon/api/v2/search?q=${encodeURIComponent(acct)}&resolve=true&type=accounts&limit=5`,
        { credentials: 'include' },
      );
      if (!search.ok) return null;
      const results = (await search.json()) as { accounts?: Array<{ id: string; acct: string; username: string }> };
      const account = (results.accounts ?? []).find(
        (a) => a.acct === acct || a.username === acct || a.acct.startsWith(`${acct}@`),
      );
      return account?.id ?? null;
    }, targetAcct);
    if (!targetId) throw new Error(`could not resolve "${targetAcct}" from ${follower}'s session.`);

    await expect
      .poll(
        async () =>
          await page.evaluate<boolean, string>(async (id) => {
            const res = await fetch(
              `/bff/user/mastodon/api/v1/accounts/relationships?id[]=${encodeURIComponent(id)}`,
              { credentials: 'include' },
            );
            if (!res.ok) return true; // cannot prove severance from a failed read
            const rels = (await res.json()) as Array<{ following?: boolean }>;
            return rels.some((r) => r.following === true);
          }, targetId),
        {
          message:
            `the block must force-sever ${follower} → ${target} (following must read false) ` +
            `within ${seconds}s — an intact follow means the external block leg never landed`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBe(false);
  },
);
