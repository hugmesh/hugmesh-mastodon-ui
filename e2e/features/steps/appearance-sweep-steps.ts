// Offline APPEARANCE SWEEP step definitions (appearance-sweep.feature) — the
// non-chat half of the appearance panel, mirroring chat-theme-steps.ts:
// programmatic single-axis sweeps over the REAL radio controls (by their
// data-testids), asserting the REAL contract surface (the data-mastodon-*
// attributes + --mastodon-text-size var PreferencesService stamps on the
// remote root). Catalogues are kept in sync with
// appearance-panel.component.ts / preferences.service.ts — a removed value or
// renamed testid fails the sweep loudly.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';

interface Axis {
  name: string;
  testidPrefix: string;
  attr: string;
  values: string[];
}

/** Every non-chat radio axis, values in catalogue order
 *  (appearance-panel.component.ts). */
const AXES: Axis[] = [
  { name: 'theme', testidPrefix: 'theme-', attr: 'data-mastodon-theme', values: ['hug-neon', 'pastel-rose', 'pastel-sky', 'pastel-mint', 'mono'] },
  { name: 'accent', testidPrefix: 'accent-', attr: 'data-mastodon-accent', values: ['neon', 'rose', 'lavender', 'sky', 'mint', 'peach'] },
  { name: 'appearance', testidPrefix: 'appearance-', attr: 'data-mastodon-appearance', values: ['auto', 'light', 'dark'] },
  { name: 'layout', testidPrefix: 'layout-', attr: 'data-mastodon-layout', values: ['single', 'multi'] },
  { name: 'density', testidPrefix: 'density-', attr: 'data-mastodon-density', values: ['comfortable', 'compact'] },
  { name: 'corners', testidPrefix: 'corners-', attr: 'data-mastodon-corners', values: ['rounded', 'square'] },
  { name: 'font', testidPrefix: 'font-', attr: 'data-mastodon-font', values: ['system', 'serif', 'mono', 'dyslexic'] },
  { name: 'textsize', testidPrefix: 'textsize-', attr: 'data-mastodon-textsize', values: ['sm', 'md', 'lg', 'xl'] },
];

/** BUILTIN_DEFAULT (preferences.service.ts) — the reset target. */
const DEFAULTS: Record<string, string> = {
  'data-mastodon-theme': 'hug-neon',
  'data-mastodon-accent': 'neon',
  'data-mastodon-appearance': 'dark',
  'data-mastodon-layout': 'single',
  'data-mastodon-density': 'comfortable',
  'data-mastodon-corners': 'rounded',
  'data-mastodon-font': 'system',
  'data-mastodon-textsize': 'md',
};

/** TEXT_SIZE_REM (preferences.service.ts). */
const TEXT_SIZE_REM: Record<string, string> = {
  sm: '0.9375rem',
  md: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
};

function axis(name: string): Axis {
  const found = AXES.find((a) => a.name === name);
  if (!found) throw new Error(`Unknown appearance axis "${name}" — use ${AXES.map((a) => a.name).join(' | ')}.`);
  return found;
}

const root = (page: Page) => page.locator('[data-testid="mastodon-view"]');

async function pick(page: Page, ax: Axis, value: string): Promise<void> {
  await page.locator(`[data-testid="${ax.testidPrefix}${value}"]`).click();
}

// ── Single-axis exhaustive sweeps ────────────────────────────────────────────

Then('sweeping every {string} appearance option applies each root attribute value', async ({ page }, name: string) => {
  const ax = axis(name);
  // Backwards first, then forwards — every value is asserted at least once
  // arriving FROM a different previous value (incl. the default itself).
  const order = [...ax.values].reverse().concat(ax.values);
  for (const value of order) {
    await pick(page, ax, value);
    await expect(root(page)).toHaveAttribute(ax.attr, value, { timeout: 10_000 });
  }
});

Then('each text size writes its expected --mastodon-text-size value', async ({ page }) => {
  const ax = axis('textsize');
  for (const value of ax.values) {
    await pick(page, ax, value);
    await expect
      .poll(
        () => root(page).evaluate((el) => (el as HTMLElement).style.getPropertyValue('--mastodon-text-size')),
        { timeout: 10_000 },
      )
      .toBe(TEXT_SIZE_REM[value]);
  }
});

// ── Boolean accessibility toggles ────────────────────────────────────────────

When('the visitor turns the {string} accessibility toggle on', async ({ page }, testid: string) => {
  const box = page.locator(`[data-testid="${testid}"]`);
  if (!(await box.isChecked())) await box.click();
  await expect(box).toBeChecked();
});

When('the visitor turns the {string} accessibility toggle off', async ({ page }, testid: string) => {
  const box = page.locator(`[data-testid="${testid}"]`);
  if (await box.isChecked()) await box.click();
  await expect(box).not.toBeChecked();
});

Then('the root carries the {string} attribute as {string}', async ({ page }, attr: string, value: string) => {
  await expect(root(page)).toHaveAttribute(attr, value, { timeout: 10_000 });
});

Then('the root does not carry the {string} attribute', async ({ page }, attr: string) => {
  await expect(root(page)).not.toHaveAttribute(attr, /.*/, { timeout: 10_000 });
});

// ── All-last config, reload persistence, full reset ──────────────────────────

function allLastConfig(): Record<string, string> {
  return Object.fromEntries(AXES.map((ax) => [ax.name, ax.values[ax.values.length - 1]]));
}

When('the visitor applies the all-last non-default appearance config', async ({ page }) => {
  const config = allLastConfig();
  for (const ax of AXES) {
    await pick(page, ax, config[ax.name]);
    await expect(root(page)).toHaveAttribute(ax.attr, config[ax.name], { timeout: 10_000 });
  }
});

Then('the root carries the all-last appearance attributes without reopening the panel', async ({ page }) => {
  const config = allLastConfig();
  for (const ax of AXES) {
    await expect(root(page)).toHaveAttribute(ax.attr, config[ax.name], { timeout: 10_000 });
  }
});

When('the visitor resets all appearance settings to default', async ({ page }) => {
  await page.locator('[data-testid="appearance-reset"]').click();
});

Then('the root carries the built-in default appearance attributes', async ({ page }) => {
  for (const [attr, value] of Object.entries(DEFAULTS)) {
    await expect(root(page)).toHaveAttribute(attr, value, { timeout: 10_000 });
  }
  // The boolean toggles reset to off → attributes removed.
  await expect(root(page)).not.toHaveAttribute('data-mastodon-contrast', /.*/);
  await expect(root(page)).not.toHaveAttribute('data-mastodon-motion', /.*/);
});
