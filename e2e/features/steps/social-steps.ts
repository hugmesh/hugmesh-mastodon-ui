// Social-surface step definitions — the role-tiered moderation/safety action
// menu (role-actions-menu.component) and the domain-lock composer gate
// (compose-box.component). These assert the REAL markup this repo renders:
//
//   role-actions-menu.component.html
//     · data-testid="role-actions"          — the whole menu (showMenu = isUser)
//     · data-testid="role-actions-trigger"  — aria-haspopup/aria-expanded
//     · data-testid="role-actions-panel"    — role="group", aria-label
//     · data-testid="tier-user"             — every authed user
//     · data-testid="tier-mod"              — session.isMod (mod OR admin)
//     · data-testid="tier-admin"            — session.isAdmin (admin only);
//                                              decide is wired to admin-bff-api
//                                              (mastodon-ui#36), NOT a stub
//     · data-testid="admin-stub-note"       — now just the decide-effect
//                                              disclosure text; the `data-stub`
//                                              attribute it used to carry is
//                                              GONE (see the TODO below)
//
//   compose-box.component.html
//     · data-testid="compose-local-only-toggle"  — aria-disabled, enforced when
//                                                   domain-locked
//     · data-testid="compose-local-only-help"    — the why-helptext
//     · data-testid="compose-visibility"         — public/unlisted options
//                                                   disabled when domain-locked
//     · data-testid="compose-visibility-help"    — the domain-lock why-helptext
//
// These live in @cluster features (they need the host serving the remote with a
// live session for the menu to mount on a real toot), but bddgen compiles them
// so `--list` proves they parse.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** Resolve the role-actions menu for a user — scoped to the first toot card so a
 *  timeline with many cards (each its own menu) is deterministic. */
function menuOf(username: string) {
  const page = pageOf(username);
  return page.locator('[data-testid="role-actions"]').first();
}

// ── Open the action menu on the first toot ──────────────────────────────────

When('{string} opens the actions menu on the first post', async ({ user }, username: string) => {
  const u = user(username).username;
  const menu = menuOf(u);
  await menu.locator('[data-testid="role-actions-trigger"]').click();
  await expect(menu.locator('[data-testid="role-actions-panel"]')).toBeVisible({ timeout: 15_000 });
});

// ── Tier visibility (USER / MOD / ADMIN additive tiers) ─────────────────────

Then('{string} sees the {string} tier', async ({ user }, username: string, testid: string) => {
  const menu = menuOf(user(username).username);
  await expect(menu.locator(`[data-testid="${testid}"]`)).toBeVisible();
});

Then('{string} does not see the {string} tier', async ({ user }, username: string, testid: string) => {
  const menu = menuOf(user(username).username);
  await expect(menu.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
});

// ── The action menu must not even render for a non-user (defence-in-depth) ───

Then('{string} sees no role-actions menu', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="role-actions"]')).toHaveCount(0);
});

// ── ALLOW: a tier control is present and operable ───────────────────────────

Then('{string} can use the {string} control', async ({ user }, username: string, testid: string) => {
  const menu = menuOf(user(username).username);
  const el = menu.locator(`[data-testid="${testid}"]`);
  await expect(el).toBeVisible();
  await expect(el).toBeEnabled();
});

// ── The ADMIN tier's decide-effect disclosure ────────────────────────────────
// TODO: STALE — mastodon-ui#36 wired ADMIN approve/deny to a real admin-bff-api
// endpoint (POST /bff/admin/moderation/{id}/decide) and dropped the
// `data-stub` attribute from `admin-stub-note` (role-actions-menu.component.html);
// the assertion below still checks for that removed attribute, so this
// @cluster scenario ("an admin gets all three tiers, with admin decisions
// marked a stub" in platform-role-access.feature) will FAIL once un-clustered
// against a live stack. Needs a real rewrite: assert the decide-effect note
// text and/or that admin-approve-*/admin-deny-* controls are present+enabled
// (once a queue row is loaded), not a stub marker that no longer exists.

Then('{string} sees the admin decisions marked as a stub', async ({ user }, username: string) => {
  const menu = menuOf(user(username).username);
  const note = menu.locator('[data-testid="admin-stub-note"]');
  await expect(note).toBeVisible();
  // The disclosure carries data-stub="true" so the contract is machine-checkable
  // (no admin-bff endpoint is wired — the decision happens in admin-ui).
  await expect(note).toHaveAttribute('data-stub', 'true');
});

// ── DOMAIN-LOCK composer gate: disabled + helptext (the ALLOW-but-restricted
//    surface) ──────────────────────────────────────────────────────────────

Then('{string} sees the local-only toggle enforced', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const toggle = page.locator('[data-testid="compose-local-only-toggle"]');
  await expect(toggle).toBeVisible();
  // aria-disabled (NOT native disabled) so a screen reader still lands on it and
  // reads the why-helptext; aria-pressed true = enforced ON for a locked user.
  await expect(toggle).toHaveAttribute('aria-disabled', 'true');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

Then('{string} sees the local-only toggle unavailable', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const toggle = page.locator('[data-testid="compose-local-only-toggle"]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-disabled', 'true');
  // NOT locked → still unwired, so it is OFF (aria-pressed false).
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

Then('{string} sees the local-only help text', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const help = page.locator('[data-testid="compose-local-only-help"]');
  await expect(help).toBeVisible();
  // The toggle points at the help via aria-describedby — assert the wiring so
  // the disabled+helptext pairing is announced, not just visually present.
  const helpId = await help.getAttribute('id');
  const describedBy = await page
    .locator('[data-testid="compose-local-only-toggle"]')
    .getAttribute('aria-describedby');
  expect(helpId && describedBy && describedBy.includes(helpId)).toBeTruthy();
});

Then('{string} sees the federated visibility options disabled', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const select = page.locator('[data-testid="compose-visibility"]');
  await expect(select).toBeVisible();
  // public + unlisted are the federated-reach options; a domain-locked actor's
  // posts never federate, so both must be disabled.
  await expect(select.locator('option[value="public"]')).toBeDisabled();
  await expect(select.locator('option[value="unlisted"]')).toBeDisabled();
  // Followers + Direct stay selectable (already non-public).
  await expect(select.locator('option[value="private"]')).toBeEnabled();
  await expect(page.locator('[data-testid="compose-visibility-help"]')).toBeVisible();
});

Then('{string} sees the federated visibility options enabled', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const select = page.locator('[data-testid="compose-visibility"]');
  await expect(select).toBeVisible();
  await expect(select.locator('option[value="public"]')).toBeEnabled();
  await expect(select.locator('option[value="unlisted"]')).toBeEnabled();
  // No domain-lock helptext for an unlocked user.
  await expect(page.locator('[data-testid="compose-visibility-help"]')).toHaveCount(0);
});
