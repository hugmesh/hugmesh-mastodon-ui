// USER-tier self-block step definitions — extends platform-role-access.feature
// (which only proves the "user-block-mastodon" control is present + enabled)
// with a REAL click and the honest-envelope disclosure, mirroring the
// mod-consequences pattern one tier down.
//
// role-actions-menu.component.ts `blockUser('internal')` records a durable
// user_block row via user-bff-api's POST /bff/user/blocks and does NOT attempt
// any external push for 'internal' (BlockService.pushExternal short-circuits
// when the platform is 'internal' — see hugmesh-user-bff-api
// block/BlockService.java), so its envelope is UNCONDITIONALLY `external: n/a`
// — deterministic on every deployment, unlike the 'mastodon' self-block (whose
// external leg is only live when `block.mastodon.enabled=true`, a runtime
// config this wave cannot assume). That determinism is exactly why this file
// exercises the 'internal' action for its ALLOW case.
//
// The 'recommend instance block' control targets `instance()` — the domain
// segment of an `acct` — which is EMPTY for every seed persona's bare local
// handle by default (only a live multi-domain run overrides via
// E2E_<USER>_ACCT). The component disables the control when there is no
// instance to recommend a block against — a real, honest client-side guard
// this file also pins.
//
// @cluster-only; bddgen still compiles these offline.

import { expect } from '@playwright/test';
import { Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

Then('{string} sees the safety outcome disclosed as an internal-only block', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const outcome = page.locator('[data-testid="role-actions-outcome"]').first();
  await expect(outcome).toBeVisible({ timeout: 15_000 });
  // Verbatim from RoleActionsMenuComponent.blockUser()'s ok() message —
  // asserting the exact "n/a" disclosure means a future accidental fake "live"
  // for an internal-only (no-external-push) block fails this test.
  await expect(outcome).toContainText(/External push: n\/a/i);
});

Then(
  '{string} sees the {string} control disabled for a local account',
  async ({ user }, username: string, testid: string) => {
    const page = pageOf(user(username).username);
    const panel = page.locator('[data-testid="role-actions-panel"]').first();
    await expect(panel).toBeVisible();
    await expect(panel.locator(`[data-testid="${testid}"]`)).toBeDisabled();
  },
);
