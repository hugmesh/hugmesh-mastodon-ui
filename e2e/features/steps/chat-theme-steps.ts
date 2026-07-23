// Offline CHAT-THEME SWEEP step definitions (chat-theme-sweep.feature).
//
// Drives the REAL appearance-panel Chat controls (radio inputs by their
// data-testids) and asserts the REAL contract surface: the data-mastodon-chat-*
// attributes + --mastodon-chat-accent-* inline CSS vars PreferencesService
// stamps on the remote root (`[data-testid="mastodon-view"]`, the
// .hug-mastodon section). Combination coverage is PROGRAMMATIC:
//   - single-axis loops sweep every value of one control,
//   - a fixed-seed mulberry32 PRNG generates the 20 mixed configs, so the
//     "random" sweep is fully deterministic run-to-run,
//   - boundary helpers apply the all-first / all-last / built-in-default combos.

import { expect, Page } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';

/** One themable axis: its radio-testid prefix, the root attribute it writes,
 *  and every legal value IN CATALOGUE ORDER (appearance-panel.component.ts —
 *  keep in sync; the sweep fails loudly if a testid disappears). */
interface Axis {
  name: string;
  testidPrefix: string;
  attr: string;
  values: string[];
}

const AXES: Axis[] = [
  { name: 'shape', testidPrefix: 'chat-shape-', attr: 'data-mastodon-chat-shape', values: ['rounded', 'square', 'sharp'] },
  { name: 'font', testidPrefix: 'chat-font-', attr: 'data-mastodon-chat-font', values: ['system', 'serif', 'rounded', 'mono'] },
  { name: 'density', testidPrefix: 'chat-density-', attr: 'data-mastodon-chat-density', values: ['cozy', 'compact'] },
  { name: 'background', testidPrefix: 'chat-bg-', attr: 'data-mastodon-chat-bg', values: ['none', 'dots', 'lined', 'stars'] },
  { name: 'vnskin', testidPrefix: 'chat-vnskin-', attr: 'data-mastodon-chat-vnskin', values: ['classic', 'glass', 'retro'] },
];

/** The BUILTIN_DEFAULT chat values (preferences.service.ts) — the "none"
 *  boundary the reset must land on. */
const DEFAULTS: Record<string, string> = {
  'data-mastodon-chat-shape': 'rounded',
  'data-mastodon-chat-font': 'system',
  'data-mastodon-chat-density': 'cozy',
  'data-mastodon-chat-bg': 'none',
  'data-mastodon-chat-vnskin': 'classic',
};

function axis(name: string): Axis {
  const found = AXES.find((a) => a.name === name);
  if (!found) throw new Error(`Unknown chat axis "${name}" — use ${AXES.map((a) => a.name).join(' | ')}.`);
  return found;
}

/** Deterministic PRNG — mulberry32 with a FIXED seed so the "pseudo-random"
 *  multi-axis sweep exercises the same 20 configs on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SWEEP_SEED = 1337;
const MIXED_CONFIG_COUNT = 20;

const root = (page: Page) => page.locator('[data-testid="mastodon-view"]');
const panel = (page: Page) => page.locator('[data-testid="appearance-panel"]');

/** Apply ONE axis value through its real radio control. */
async function pick(page: Page, ax: Axis, value: string): Promise<void> {
  await page.locator(`[data-testid="${ax.testidPrefix}${value}"]`).click();
}

/** Apply a full 5-axis config and assert ALL five root attributes. */
async function applyAndAssertConfig(page: Page, config: Record<string, string>): Promise<void> {
  for (const ax of AXES) await pick(page, ax, config[ax.name]);
  for (const ax of AXES) {
    await expect(root(page)).toHaveAttribute(ax.attr, config[ax.name], { timeout: 10_000 });
  }
}

function boundaryConfig(which: 'first' | 'last'): Record<string, string> {
  return Object.fromEntries(
    AXES.map((ax) => [ax.name, which === 'first' ? ax.values[0] : ax.values[ax.values.length - 1]]),
  );
}

/** Set an <input type="color"> value and fire the (change) binding the panel
 *  listens on (Playwright's fill targets text-editable inputs only). */
async function setColor(page: Page, testid: string, hex: string): Promise<void> {
  await page.locator(`[data-testid="${testid}"]`).evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
}

async function accentVar(page: Page, cssVar: string): Promise<string> {
  return root(page).evaluate((el, name) => (el as HTMLElement).style.getPropertyValue(name), cssVar);
}

// ── Setup ────────────────────────────────────────────────────────────────────

Given('the preferences API is stubbed', async ({ page }) => {
  // Deterministic offline behaviour: the durable PUT/GET succeed with an empty
  // store and no org default is configured, so ONLY the visitor's own clicks
  // (persisted to localStorage) drive the asserted state.
  await page.route('**/bff/user/preferences', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/bff/mastodon/appearance-default', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
});

Given('the visitor opens the appearance panel', async ({ page }) => {
  await page.locator('[data-testid="appearance-trigger"]').click();
  await expect(panel(page)).toBeVisible({ timeout: 10_000 });
});

// ── Single-axis exhaustive sweeps ────────────────────────────────────────────

Then('sweeping every {string} chat option applies each root attribute value', async ({ page }, name: string) => {
  const ax = axis(name);
  // Walk BACKWARDS first so the default value is also proven by an explicit
  // transition (default → last → … → default → …), then forwards — every value
  // is asserted at least once from a DIFFERENT previous value.
  const order = [...ax.values].reverse().concat(ax.values);
  for (const value of order) {
    await pick(page, ax, value);
    await expect(root(page)).toHaveAttribute(ax.attr, value, { timeout: 10_000 });
  }
});

// ── Accent colour vars ───────────────────────────────────────────────────────

When("the visitor picks {string} for their own bubbles", async ({ page }, hex: string) => {
  await setColor(page, 'chat-accent-mine', hex);
});

When("the visitor picks {string} for the other side's bubbles", async ({ page }, hex: string) => {
  await setColor(page, 'chat-accent-theirs', hex);
});

Then('the root carries {string} as the mine accent var', async ({ page }, hex: string) => {
  await expect.poll(() => accentVar(page, '--mastodon-chat-accent-mine'), { timeout: 10_000 }).toBe(hex);
});

Then('the root carries {string} as the theirs accent var', async ({ page }, hex: string) => {
  await expect.poll(() => accentVar(page, '--mastodon-chat-accent-theirs'), { timeout: 10_000 }).toBe(hex);
});

// ── Seeded multi-axis sweep + boundaries ─────────────────────────────────────

Then(
  'a seeded sweep of 20 mixed chat configs applies every root attribute combination',
  async ({ page }) => {
    const rand = mulberry32(SWEEP_SEED);
    for (let i = 0; i < MIXED_CONFIG_COUNT; i++) {
      const config = Object.fromEntries(
        AXES.map((ax) => [ax.name, ax.values[Math.floor(rand() * ax.values.length)]]),
      );
      await applyAndAssertConfig(page, config);
    }
  },
);

Then('the all-first boundary chat config applies every root attribute', async ({ page }) => {
  await applyAndAssertConfig(page, boundaryConfig('first'));
});

Then('the all-last boundary chat config applies every root attribute', async ({ page }) => {
  await applyAndAssertConfig(page, boundaryConfig('last'));
});

When('the visitor resets the chat style', async ({ page }) => {
  await page.locator('[data-testid="chat-reset"]').click();
});

Then('the root carries the built-in default chat attributes', async ({ page }) => {
  for (const [attr, value] of Object.entries(DEFAULTS)) {
    await expect(root(page)).toHaveAttribute(attr, value, { timeout: 10_000 });
  }
});

// ── Persistence across a reload ──────────────────────────────────────────────

When('the visitor reloads the page', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(root(page)).toBeVisible({ timeout: 15_000 });
});

Then(
  'the root carries the all-last boundary chat attributes without reopening the panel',
  async ({ page }) => {
    const config = boundaryConfig('last');
    for (const ax of AXES) {
      await expect(root(page)).toHaveAttribute(ax.attr, config[ax.name], { timeout: 10_000 });
    }
  },
);

// ── Viewport fit (phone / tablet) ────────────────────────────────────────────

Then('the appearance panel fits the viewport without horizontal page scroll', async ({ page }) => {
  await expect(panel(page)).toBeVisible({ timeout: 10_000 });
  const box = await panel(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(viewport.width);
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

Then('the Chat section can be scrolled into view inside the panel', async ({ page }) => {
  const section = page.locator('[data-testid="chat-section"]');
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible({ timeout: 10_000 });
  // …and the panel really is the scroll container doing the work (its content
  // overflows its box on a phone, so internal scrolling is what made this
  // reachable — the page body never had to scroll horizontally).
  const scrolls = await panel(page).evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
});
