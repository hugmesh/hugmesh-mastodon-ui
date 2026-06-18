// Accessibility step definitions. The mastodon-ui carries the org a11y
// standard for the social surface: a skip link that moves focus to the main
// region, named ARIA landmarks on the timeline column, a menu (the role-actions
// panel) that traps Escape and restores focus to its trigger on close, and
// live-region announcements for async action outcomes. These steps assert those
// contracts against the real shell + component markup:
//   - app.component.html  — `<a class="skip" href="#main-content">` +
//                           `<main id="main-content" tabindex="-1">`.
//   - mastodon-timeline.component.html — `<section data-testid="mastodon-view"
//                           aria-labelledby="timeline-heading">` + `<h2
//                           id="timeline-heading">`.
//   - role-actions-menu.component.html — trigger aria-haspopup/aria-expanded,
//                           panel role="group" aria-label, Escape closes +
//                           returns focus to the trigger; outcome live region
//                           role=status|alert.

import { expect } from '@playwright/test';
import { Then, When } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Skip-link ────────────────────────────────────────────────────────────────

Then('{string} can tab to the skip link', async ({}, username: string) => {
  const page = pageOf(username);
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#main-content');
});

Then('activating the skip link moves focus to the main region', async ({}, username: string) => {
  const page = pageOf(username);
  await page.locator('a.skip').press('Enter');
  const main = page.locator('main#main-content');
  await expect(main).toBeFocused();
  // The skip target must be programmatically focusable without being a tab stop.
  await expect(main).toHaveAttribute('tabindex', '-1');
});

// ── ARIA landmarks / labels ──────────────────────────────────────────────────

Then('the {string} view has an accessible name', async ({}, username: string, testid: string) => {
  const page = pageOf(username);
  const view = page.locator(`[data-testid="${testid}"]`);
  // The timeline column is aria-labelledby its heading; assert one of
  // labelledby/label is present so assistive tech can name the region.
  const labelledby = await view.getAttribute('aria-labelledby');
  const ariaLabel = await view.getAttribute('aria-label');
  expect(Boolean(labelledby) || Boolean(ariaLabel)).toBe(true);
});

Then('the timeline feed exposes a feed role', async ({}, username: string) => {
  const page = pageOf(username);
  // The timeline list is role="feed" with aria-busy reflecting loading — the
  // virtualised-feed a11y contract.
  const feed = page.locator('[data-testid="mastodon-timeline"]');
  await expect(feed).toHaveAttribute('role', 'feed');
  await expect(feed).toHaveAttribute('aria-busy', /true|false/);
});

// ── Menu trigger / panel ARIA (the role-actions popup) ──────────────────────

Then('the {string} actions trigger exposes a popup', async ({}, username: string) => {
  const page = pageOf(username);
  const trigger = page.locator('[data-testid="role-actions-trigger"]').first();
  await expect(trigger).toHaveAttribute('aria-haspopup', 'true');
  // Collapsed before open.
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

Then('the actions panel is a named group', async ({}, username: string) => {
  const page = pageOf(username);
  const panel = page.locator('[data-testid="role-actions-panel"]').first();
  await expect(panel).toHaveAttribute('role', 'group');
  const name = await panel.getAttribute('aria-label');
  expect(name && name.length > 0).toBe(true);
});

// ── Focus restoration: Escape closes the panel and returns focus to trigger ──

When('{string} presses Escape in the actions panel', async ({}, username: string) => {
  const page = pageOf(username);
  await page.locator('[data-testid="role-actions-panel"]').first().press('Escape');
});

Then('focus is restored to the actions trigger', async ({}, username: string) => {
  const page = pageOf(username);
  const trigger = page.locator('[data-testid="role-actions-trigger"]').first();
  await expect(trigger).toBeFocused();
  // Panel collapsed → trigger reflects aria-expanded=false again.
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

// ── Live-region async announcement (the action outcome) ─────────────────────

Then('the action outcome is announced via a live region', async ({}, username: string) => {
  const page = pageOf(username);
  const outcome = page.locator('[data-testid="role-actions-outcome"]').first();
  await expect(outcome).toBeVisible();
  // Success → role=status/polite; error → role=alert/assertive. Assert it is one
  // of the two so a screen reader announces the result either way.
  const role = await outcome.getAttribute('role');
  const live = await outcome.getAttribute('aria-live');
  expect(['status', 'alert']).toContain(role);
  expect(['polite', 'assertive']).toContain(live);
});

// ── Compose error live region (over-length post) ────────────────────────────

Then('the compose over-length error is an assertive alert', async ({}, username: string) => {
  const page = pageOf(username);
  const err = page.locator('[data-testid="compose-error"]');
  await expect(err).toBeVisible();
  await expect(err).toHaveAttribute('role', 'alert');
  await expect(err).toHaveAttribute('aria-live', 'assertive');
});
