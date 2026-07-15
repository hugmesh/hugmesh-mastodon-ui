// Offline VN CHAT step definitions (vn-chat-offline.feature).
//
// The dev-shell service targets the same-origin hsproxy paths
// (/bff/user/mastodon/api/...), so page.route stubs the conversations list +
// the status context with a deterministic thread — while the VN SCENE MANIFEST
// and every scene/prop SVG are the REAL shipped assets `ng serve` serves from
// assets/vn/scenes. The scene/prop sweeps therefore enumerate the live
// manifest (fetched in-page), never a fixture copy that could drift.

import { expect, Page } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';

const CONVERSATIONS_API = '**/bff/user/mastodon/api/v1/conversations*';
const CONTEXT_API = '**/bff/user/mastodon/api/v1/statuses/*/context';

interface StubAccount {
  id: string;
  name: string;
}

const RILEY: StubAccount = { id: 'vn-acct-1', name: 'Riley' };
const SAM: StubAccount = { id: 'vn-acct-2', name: 'Sam' };
const CASEY: StubAccount = { id: 'vn-acct-3', name: 'Casey' };

/** The display name the "third author" assertion checks (the newest message's
 *  sender — the VN view opens on the latest line). */
const THIRD_AUTHOR = CASEY.name;

function account(a: StubAccount): Record<string, unknown> {
  return {
    id: a.id,
    username: a.name.toLowerCase(),
    acct: a.name.toLowerCase(),
    url: `https://example.test/@${a.name.toLowerCase()}`,
    display_name: a.name,
    note: '',
    // A real shipped asset so sprite portraits render without a 404.
    avatar: 'assets/vn/scenes/vn_prop_lamp.svg',
    avatar_static: 'assets/vn/scenes/vn_prop_lamp.svg',
    header: '',
    header_static: '',
    locked: false,
    bot: false,
    created_at: '2026-01-01T00:00:00.000Z',
    followers_count: 0,
    following_count: 0,
    statuses_count: 1,
    fields: [],
    emojis: [],
  };
}

function status(id: string, author: StubAccount, createdAt: string, content: string): Record<string, unknown> {
  return {
    id,
    uri: `https://example.test/statuses/${id}`,
    url: null,
    created_at: createdAt,
    edited_at: null,
    content,
    visibility: 'direct',
    sensitive: false,
    spoiler_text: '',
    language: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    account: account(author),
    media_attachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    reblog: null,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    poll: null,
    card: null,
  };
}

/** Arm the conversations + context stubs for ONE conversation whose thread is
 *  `ancestors` + `last`. Must run BEFORE navigation (Background order). */
async function stubThread(
  page: Page,
  ancestors: Record<string, unknown>[],
  last: Record<string, unknown>,
): Promise<void> {
  const conversation = {
    id: 'vn-conv-1',
    unread: false,
    accounts: [account(RILEY), account(SAM), account(CASEY)],
    last_status: last,
  };
  await page.route(CONVERSATIONS_API, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([conversation]) }),
  );
  await page.route(CONTEXT_API, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ancestors, descendants: [] }),
    }),
  );
}

const vnRoot = (page: Page) => page.locator('[data-testid="vn-chat"]');
const dialogText = (page: Page) => page.locator('[data-testid="vn-dialog-text"]');
const navButton = (page: Page, kind: string) => page.locator(`[data-testid="vn-${kind}"]`);

async function enterVn(page: Page): Promise<void> {
  const toggle = page.locator('[data-testid="conversation-vn-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  await toggle.click();
  await expect(vnRoot(page)).toBeVisible({ timeout: 15_000 });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

// ── Backend stubs ────────────────────────────────────────────────────────────

Given('the conversations API is stubbed with a three-message direct thread', async ({ page }) => {
  const m1 = status('vn-dm-1', RILEY, '2026-07-01T10:00:00.000Z', '<p>First: shall we try VN mode?</p>');
  const m2 = status('vn-dm-2', SAM, '2026-07-01T10:05:00.000Z', '<p>Second: yes, switch it on.</p>');
  const m3 = status('vn-dm-3', CASEY, '2026-07-01T10:10:00.000Z', '<p>Third: and here we are.</p>');
  await stubThread(page, [m1, m2], m3);
});

Given('the conversations API is stubbed with an over-long direct message', async ({ page }) => {
  // 1500 plain-text chars — comfortably past the 1000-char dialogue clamp.
  const long = status('vn-dm-long', RILEY, '2026-07-01T10:00:00.000Z', `<p>${'m'.repeat(1500)}</p>`);
  await stubThread(page, [], long);
});

// ── Entering / re-entering VN mode ───────────────────────────────────────────

Given('the visitor enters VN mode on the stubbed conversation', async ({ page }) => {
  await enterVn(page);
});

Given('the visitor prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

When('the visitor reloads into VN mode on the stubbed conversation', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enterVn(page);
});

// ── Stage + dialogue assertions ──────────────────────────────────────────────

Then('the VN stage and dialogue box are visible', async ({ page }) => {
  await expect(page.locator('[data-testid="vn-stage"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="vn-dialog"]')).toBeVisible({ timeout: 10_000 });
});

Then('the VN position reads {string}', async ({ page }, position: string) => {
  await expect(page.locator('[data-testid="vn-position"]')).toHaveText(position, { timeout: 10_000 });
});

Then('the VN nameplate reads the third author', async ({ page }) => {
  await expect(page.locator('[data-testid="vn-nameplate"]')).toHaveText(THIRD_AUTHOR, { timeout: 10_000 });
});

// ── Thread navigation ────────────────────────────────────────────────────────

When('the visitor presses the VN {string} control', async ({ page }, kind: string) => {
  await navButton(page, kind).click();
});

Then('the VN {string} control is disabled', async ({ page }, kind: string) => {
  await expect(navButton(page, kind)).toBeDisabled({ timeout: 10_000 });
});

// ── Scene / prop sweeps over the REAL shipped manifest ───────────────────────

When('the visitor opens the VN scene picker', async ({ page }) => {
  await page.locator('[data-testid="vn-scene-picker-toggle"]').click();
  await expect(page.locator('[data-testid="vn-scene-picker"]')).toBeVisible({ timeout: 10_000 });
});

interface ManifestEntry {
  id: string;
  displayName: string;
  file: string;
}

async function shippedManifest(page: Page): Promise<{ scenes: ManifestEntry[]; props: ManifestEntry[] }> {
  const manifest = await page.evaluate(() =>
    fetch('assets/vn/scenes/scenes.json').then((r) => r.json() as Promise<{ scenes: never[]; props: never[] }>),
  );
  if (!manifest.scenes?.length || !manifest.props?.length) {
    throw new Error('The shipped VN manifest did not load — is ng serve serving assets/vn/scenes?');
  }
  return manifest;
}

Then('selecting each shipped scene updates the stage background in turn', async ({ page }) => {
  const { scenes } = await shippedManifest(page);
  expect(scenes.length).toBeGreaterThanOrEqual(6); // the shipped catalogue
  for (const scene of scenes) {
    await page.locator(`[data-testid="vn-scene-${scene.id}"]`).click({ force: true }); // visually-hidden radio
    await expect(page.locator('[data-testid="vn-scene-bg"]')).toHaveAttribute(
      'src',
      new RegExp(scene.file.replace(/\./g, '\\.')),
      { timeout: 10_000 },
    );
  }
});

Then('toggling each shipped prop adds it to and removes it from the stage', async ({ page }) => {
  const { props } = await shippedManifest(page);
  expect(props.length).toBeGreaterThanOrEqual(8); // the shipped catalogue
  for (const prop of props) {
    const checkbox = page.locator(`[data-testid="vn-prop-${prop.id}"]`);
    const onStage = page.locator(`[data-testid="vn-stage-prop-${prop.id}"]`);
    await checkbox.click();
    await expect(onStage).toBeVisible({ timeout: 10_000 });
    await checkbox.click();
    await expect(onStage).toHaveCount(0, { timeout: 10_000 });
  }
});

// ── Reduced motion ───────────────────────────────────────────────────────────

Then('the VN dialogue text renders without the typewriter animation', async ({ page }) => {
  await expect(dialogText(page)).toBeVisible({ timeout: 10_000 });
  await expect(dialogText(page)).not.toHaveClass(/vn-typewriter/);
});

// ── 1000-char dialogue clamp ─────────────────────────────────────────────────

Then('the VN dialogue text is clamped near 1000 characters', async ({ page }) => {
  await expect(dialogText(page)).toBeVisible({ timeout: 10_000 });
  const length = (await dialogText(page).textContent())?.trim().length ?? 0;
  expect(length).toBeLessThanOrEqual(1001); // 1000 chars + the ellipsis
  await expect(page.locator('[data-testid="vn-dialog-expand"]')).toHaveAttribute('aria-expanded', 'false');
});

When('the visitor expands the clamped message with the keyboard', async ({ page }) => {
  await page.locator('[data-testid="vn-dialog-expand"]').focus();
  await expect(page.locator('[data-testid="vn-dialog-expand"]')).toBeFocused();
  await page.keyboard.press('Enter');
});

Then('the VN dialogue text shows the full message', async ({ page }) => {
  await expect
    .poll(async () => (await dialogText(page).textContent())?.trim().length ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(1400);
  await expect(page.locator('[data-testid="vn-dialog-expand"]')).toHaveAttribute('aria-expanded', 'true');
});

// ── Focus is not trapped ─────────────────────────────────────────────────────

Then('keyboard focus can travel from the VN navigation into the reply composer', async ({ page }) => {
  await navButton(page, 'latest').focus();
  const composer = page.locator('[data-testid="vn-reply"] [data-testid="mastodon-input"]');
  let reached = false;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await composer.evaluate((el) => el === document.activeElement)) {
      reached = true;
      break;
    }
  }
  expect(reached, 'Tab must escape the VN region and reach the reply composer').toBe(true);
});

// ── Viewport fit ─────────────────────────────────────────────────────────────

Then('the VN stage letterboxes inside the viewport', async ({ page }) => {
  const stage = page.locator('[data-testid="vn-stage"]');
  await expect(stage).toBeVisible({ timeout: 10_000 });
  const box = (await stage.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
});

Then('the VN navigation controls are fully inside the viewport', async ({ page }) => {
  const viewport = page.viewportSize()!;
  for (const kind of ['prev', 'next', 'latest']) {
    const btn = navButton(page, kind);
    await btn.scrollIntoViewIfNeeded();
    const box = (await btn.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  }
});
