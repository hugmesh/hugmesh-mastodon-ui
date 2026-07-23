// LIVE VN-chat-mode step definitions (vn-chat-mode.feature) — closes the
// disclosed validate-gate gap: the feature shipped with NO step glue (18 of the
// repo-wide 39 missing steps; the no-filter `npx bddgen` the .gitlab-ci.yml
// e2e:bdd job runs exited 1). These steps drive the SHIPPED markup —
// conversations-column.component.html's per-row `conversation-vn-toggle` and
// vn-chat-view.component.html's `vn-*` testids — against a live stack, per the
// feature's honesty contract:
//
//   - every conversation is created by a DIFFERENT persona than the observer
//     (the posting/observation steps live in timeline-steps.ts / this file);
//   - scene/prop names are resolved through the REAL shipped manifest
//     (assets/vn/scenes/scenes.json, fetched in-page) — never a fixture copy;
//   - the VN reply is believed only after the captured POST response proves
//     visibility=direct AND in_reply_to_id (the same oracle
//     direct-message-steps.ts uses).
//
// @cluster-only; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, statusRegistry, CreatedStatus, onScenarioReset } from './_registry';
import { acctFor } from '../../tests/helpers/roles';
import { uniqueMarker } from '../../tests/helpers/social';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

function statusOf(tag: string): CreatedStatus {
  const created = statusRegistry.get(tag);
  if (!created) {
    throw new Error(`No status tagged "${tag}" was created in this scenario — add a posting step first.`);
  }
  return created;
}

/** Track which conversation row a persona toggled VN mode on: after the toggle
 *  the row's classic toot-card (and its marker text) is REPLACED by the VN
 *  stage, so "the row for tag X" can no longer be re-located by marker text
 *  alone once a Prev navigation moves the dialogue off the newest message. */
const vnRowByUser = new Map<string, ReturnType<Page['locator']>>();
// Scenario-scoped: a leaked entry from the previous scenario would be a
// Locator on a CLOSED page and would defeat the "in this scenario" guards.
onScenarioReset(() => vnRowByUser.clear());

function vnRoot(username: string) {
  const row = vnRowByUser.get(username);
  if (!row) throw new Error(`"${username}" has not toggled VN mode in this scenario.`);
  return row.locator('[data-testid="vn-chat"]');
}

const NAV_TESTIDS: Record<string, string> = {
  Prev: 'vn-prev',
  Next: 'vn-next',
  Latest: 'vn-latest',
};

function navTestid(label: string): string {
  const id = NAV_TESTIDS[label];
  if (!id) throw new Error(`Unknown VN nav control "${label}" — use ${Object.keys(NAV_TESTIDS).join(' | ')}.`);
  return id;
}

interface ManifestEntry {
  id: string;
  displayName: string;
  file: string;
}

/** The REAL shipped scene/prop manifest, fetched in-page (same-origin under the
 *  host mount) so a displayName in a feature line resolves to the true id/file
 *  — a renamed or missing entry fails loudly instead of matching nothing. */
async function shippedEntry(page: Page, kind: 'scenes' | 'props', displayName: string): Promise<ManifestEntry> {
  const manifest = await page.evaluate(() =>
    fetch('assets/vn/scenes/scenes.json').then(
      (r) => r.json() as Promise<{ scenes: ManifestEntry[]; props: ManifestEntry[] }>,
    ),
  );
  const entry = (manifest[kind] ?? []).find((e) => e.displayName === displayName);
  if (!entry) {
    const known = (manifest[kind] ?? []).map((e) => e.displayName).join(', ');
    throw new Error(`No shipped ${kind} entry named "${displayName}" — shipped: ${known}`);
  }
  return entry;
}

// ── Entering / leaving VN mode ───────────────────────────────────────────────

When('{string} toggles VN mode on the {string} conversation', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="conversations-column"]').waitFor({ state: 'visible', timeout: 15_000 });
  // Locate the row by marker BEFORE toggling (VN mode swaps the classic card
  // out); remember the row handle for every later VN assertion. When VN mode is
  // already on (the exit half of the toggle scenario), fall back to the
  // remembered row.
  const remembered = vnRowByUser.get(username);
  const byMarker = page.locator('[data-testid="conversation-item"]', { hasText: statusOf(tag).text }).first();
  const row = (await byMarker.count()) > 0 ? byMarker : remembered;
  if (!row) throw new Error(`No conversation row found for "${tag}" and none remembered for ${username}.`);
  await row.locator('[data-testid="conversation-vn-toggle"]').click();
  vnRowByUser.set(username, row);
});

Then('the VN toggle of the {string} conversation reads pressed', async ({ user }, username: string, tag: string) => {
  void tag; // the remembered row IS the tag's row (set by the toggle step)
  const row = vnRowByUser.get(user(username).username);
  if (!row) throw new Error(`"${username}" has not toggled VN mode in this scenario.`);
  await expect(row.locator('[data-testid="conversation-vn-toggle"]')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 10_000,
  });
});

Then(
  'the visual-novel stage is shown for the {string} conversation',
  async ({ user }, username: string, tag: string) => {
    void tag;
    const root = vnRoot(user(username).username);
    await expect(root.locator('[data-testid="vn-stage"]')).toBeVisible({ timeout: 15_000 });
    await expect(root.locator('[data-testid="vn-dialog"]')).toBeVisible({ timeout: 15_000 });
  },
);

Then(
  'the classic conversation row is shown for the {string} conversation',
  async ({ user }, username: string, tag: string) => {
    const row = vnRowByUser.get(user(username).username);
    if (!row) throw new Error(`"${username}" has not toggled VN mode in this scenario.`);
    // Exit half: the VN stage is gone and the classic toot-card (with the
    // marker text) is back in the same row.
    await expect(row.locator('[data-testid="vn-chat"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(row.locator('[data-testid="toot-content"]', { hasText: statusOf(tag).text })).toBeVisible({
      timeout: 10_000,
    });
  },
);

// ── Dialogue box + speaker sprite ────────────────────────────────────────────

Then(
  'the VN dialogue box shows the {string} message attributed to {string}',
  async ({ user }, tag: string, sender: string) => {
    // The observer is whoever toggled VN mode in this scenario (exactly one
    // persona per the feature's flows).
    const [username] = [...vnRowByUser.keys()];
    if (!username) throw new Error('No persona has toggled VN mode in this scenario.');
    const root = vnRoot(username);
    await expect(root.locator('[data-testid="vn-dialog-text"]')).toContainText(statusOf(tag).text, {
      timeout: 15_000,
    });
    // Attribution: the nameplate carries the sender's display name (the seed
    // catalogue provisions display names equal to usernames; acctFor's local
    // part is that username).
    const senderName = acctFor(user(sender)).split('@')[0];
    await expect(root.locator('[data-testid="vn-nameplate"]')).toHaveText(new RegExp(senderName, 'i'), {
      timeout: 10_000,
    });
  },
);

Then('a participant sprite for {string} is highlighted as the speaker', async ({ user }, sender: string) => {
  const [username] = [...vnRowByUser.keys()];
  if (!username) throw new Error('No persona has toggled VN mode in this scenario.');
  const root = vnRoot(username);
  const senderName = acctFor(user(sender)).split('@')[0];
  // The speaking sprite carries .is-speaking plus an sr "Speaking." marker; it
  // must be the sprite whose plate names the sender.
  const speaking = root.locator('.vn-sprite.is-speaking', { hasText: new RegExp(senderName, 'i') });
  await expect(speaking).toHaveCount(1, { timeout: 15_000 });
  await expect(speaking.locator('.sr', { hasText: 'Speaking.' })).toHaveCount(1);
});

Then('the VN dialogue box shows the {string} message', async ({}, tag: string) => {
  const [username] = [...vnRowByUser.keys()];
  if (!username) throw new Error('No persona has toggled VN mode in this scenario.');
  const root = vnRoot(username);
  await expect(root.locator('[data-testid="vn-dialog-text"]')).toContainText(statusOf(tag).text, {
    timeout: 15_000,
  });
});

// ── Threading: a real reply from the other persona ───────────────────────────

Given(
  '{string} replies to the {string} conversation tagged {string}',
  async ({ user }, username: string, parentTag: string, replyTag: string) => {
    // The ORIGINAL SENDER extends the thread through the classic conversation
    // reply composer (their own row still shows the classic view) — a REAL
    // child status captured off the POST, same oracle as direct-message-steps.
    const parent = statusOf(parentTag);
    if (!parent.id) throw new Error(`status "${parentTag}" has no captured id — the posting step must capture it.`);
    const page = pageOf(user(username).username);
    await page.goto('/social/mastodon/direct', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="conversations-column"]').waitFor({ state: 'visible', timeout: 15_000 });
    const row = page.locator('[data-testid="conversation-item"]', { hasText: parent.text }).first();
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    const toggle = row.locator('[data-testid="conversation-reply-toggle"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });
    const composer = row.locator('.conversation-reply');
    const text = uniqueMarker(replyTag);
    await composer.locator('[data-testid="mastodon-input"]').fill(text);
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await composer.locator('[data-testid="mastodon-post"]').click();
    const response = await responsePromise;
    if (!response.ok()) throw new Error(`replying "${replyTag}" failed: ${response.status()}`);
    const body = (await response.json()) as { id?: string; visibility?: string; in_reply_to_id?: string };
    expect(body.visibility, 'a conversation reply must post with direct visibility').toBe('direct');
    statusRegistry.set(replyTag, { text, id: body.id ?? null, visibility: body.visibility ?? null });
  },
);

// ── Prev / Next / Latest navigation ──────────────────────────────────────────

When('{string} presses the VN {string} control', async ({ user }, username: string, label: string) => {
  const root = vnRoot(user(username).username);
  await root.locator(`[data-testid="${navTestid(label)}"]`).click();
});

Then('the VN {string} control is disabled at the oldest message', async ({}, label: string) => {
  const [username] = [...vnRowByUser.keys()];
  if (!username) throw new Error('No persona has toggled VN mode in this scenario.');
  const root = vnRoot(username);
  await expect(root.locator(`[data-testid="${navTestid(label)}"]`)).toBeDisabled({ timeout: 10_000 });
});

// ── Scene & prop picker (per-user durable preference) ────────────────────────

When('{string} opens the VN scene picker', async ({ user }, username: string) => {
  const root = vnRoot(user(username).username);
  await root.locator('[data-testid="vn-scene-picker-toggle"]').click();
  await expect(root.locator('[data-testid="vn-scene-picker"]')).toBeVisible({ timeout: 10_000 });
});

When('{string} picks the {string} scene', async ({ user }, username: string, sceneName: string) => {
  const page = pageOf(user(username).username);
  const scene = await shippedEntry(page, 'scenes', sceneName);
  const root = vnRoot(user(username).username);
  await root.locator(`[data-testid="vn-scene-${scene.id}"]`).click({ force: true }); // visually-hidden radio
});

When('{string} enables the {string} prop', async ({ user }, username: string, propName: string) => {
  const page = pageOf(user(username).username);
  const prop = await shippedEntry(page, 'props', propName);
  const root = vnRoot(user(username).username);
  const checkbox = root.locator(`[data-testid="vn-prop-${prop.id}"]`);
  // Idempotent "enable" (a re-run must not toggle it back OFF).
  if (!(await checkbox.isChecked())) await checkbox.click();
  await expect(checkbox).toBeChecked({ timeout: 10_000 });
});

Then('the VN stage background is the {string} scene', async ({ user }, sceneName: string) => {
  const [username] = [...vnRowByUser.keys()];
  if (!username) throw new Error('No persona has toggled VN mode in this scenario.');
  const page = pageOf(username);
  void user;
  const scene = await shippedEntry(page, 'scenes', sceneName);
  const root = vnRoot(username);
  await expect(root.locator('[data-testid="vn-scene-bg"]')).toHaveAttribute(
    'src',
    new RegExp(scene.file.replace(/\./g, '\\.')),
    { timeout: 10_000 },
  );
});

Then('the {string} prop is on the VN stage', async ({}, propName: string) => {
  const [username] = [...vnRowByUser.keys()];
  if (!username) throw new Error('No persona has toggled VN mode in this scenario.');
  const page = pageOf(username);
  const prop = await shippedEntry(page, 'props', propName);
  const root = vnRoot(username);
  await expect(root.locator(`[data-testid="vn-stage-prop-${prop.id}"]`)).toBeVisible({ timeout: 10_000 });
});

// ── Reload (durable-preference half) ─────────────────────────────────────────

When('{string} reloads the page', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // The full-reload persistence proof: the scene/prop choice must come back
  // from the durable stores (localStorage + GET /bff/user/preferences), not
  // the in-memory signal. VN mode itself is per-visit, so the remembered row
  // handle is cleared — the feature re-toggles after the reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="conversations-column"]').waitFor({ state: 'visible', timeout: 15_000 });
  vnRowByUser.delete(user(username).username);
});

// ── VN reply seam ────────────────────────────────────────────────────────────

/** Last VN-reply POST envelope, keyed by tag, for the captured-response step. */
const vnReplyEnvelopes = new Map<string, { visibility: string | null; inReplyToId: string | null }>();
onScenarioReset(() => vnReplyEnvelopes.clear());

When('{string} replies from the VN reply seam tagged {string}', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  const root = vnRoot(user(username).username);
  const seam = root.locator('[data-testid="vn-reply"]');
  await seam.waitFor({ state: 'visible', timeout: 15_000 });
  const text = uniqueMarker(tag);
  await seam.locator('[data-testid="mastodon-input"]').fill(text);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await seam.locator('[data-testid="mastodon-post"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`VN reply "${tag}" failed: ${response.status()}`);
  const body = (await response.json()) as { id?: string; visibility?: string; in_reply_to_id?: string };
  statusRegistry.set(tag, { text, id: body.id ?? null, visibility: body.visibility ?? null });
  vnReplyEnvelopes.set(tag, {
    visibility: body.visibility ?? null,
    inReplyToId: body.in_reply_to_id ?? null,
  });
});

Then(
  'the captured {string} POST response has visibility {string} and a set in_reply_to_id',
  async ({}, tag: string, visibility: string) => {
    const envelope = vnReplyEnvelopes.get(tag);
    if (!envelope) throw new Error(`No captured VN-reply envelope for "${tag}".`);
    expect(envelope.visibility, `the "${tag}" reply must carry ${visibility} visibility`).toBe(visibility);
    expect(envelope.inReplyToId, `the "${tag}" reply must be threaded to a parent`).toBeTruthy();
  },
);
