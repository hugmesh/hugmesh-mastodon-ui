// Shared VIEWPORT steps for the mobile/tablet hardening scenarios (chat-theme
// sweep, VN offline, recorder offline). Playwright's per-test viewport is
// resized in-flight — the Angular layout is pure CSS (flex/grid + aspect-ratio
// + max-width), so a resize immediately re-flows and the fit assertions below
// hold with no reload.
//
// The "no horizontal page scroll" check is the platform mobile invariant:
// document scrollWidth must not exceed the viewport width (1px slack for
// classic zoom/rounding artefacts).

import { expect } from '@playwright/test';
import { Given, Then } from '../support/fixtures';

export const VIEWPORTS = {
  phone: { width: 360, height: 740 },
  tablet: { width: 768, height: 1024 },
  'tablet-landscape': { width: 1024, height: 768 },
} as const;

Given('the viewport is a phone', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.phone);
});

Given('the viewport is a tablet', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.tablet);
});

Given('the viewport is a tablet in landscape', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS['tablet-landscape']);
});

Then('there is no horizontal page scroll', async ({ page }) => {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const doc = document.documentElement;
          return doc.scrollWidth - doc.clientWidth;
        }),
      { timeout: 10_000 },
    )
    .toBeLessThanOrEqual(1);
});
