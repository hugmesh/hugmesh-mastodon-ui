// CONTENT-WARNING / SENSITIVE-MEDIA step definitions (content-warnings.feature)
// — the cross-user CW round trip plus the sensitive-media reveal that gates
// the fixed toot-card defect (sensitive without spoiler_text previously had NO
// reveal control: [class.sensitive] blurred it forever).
//
// The CW leg drives the real composer (CW toggle + spoiler input); the
// sensitive leg seeds through the raw compose API from the author's
// cookie-authed session (the composer has no per-post sensitive toggle — the
// OBSERVED surface here is the OBSERVER'S reveal control, so API seeding of
// the author's post is the honest tool, same as post-visibility's follower
// seeds). The PNG is generated in-page (canvas), uploaded to /api/v2/media,
// and the status is believed only off the POST echoing sensitive:true.
//
// @cluster-only; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, statusRegistry, CreatedStatus, onScenarioReset } from './_registry';
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

/** The spoiler (CW header) marker for a tag; the registered status text is the
 *  HIDDEN BODY marker. Both are run-unique so neither can match a stale run. */
const spoilerByTag = new Map<string, string>();
onScenarioReset(() => spoilerByTag.clear());

function spoilerOf(tag: string): string {
  const spoiler = spoilerByTag.get(tag);
  if (!spoiler) throw new Error(`No spoiler registered for "${tag}" — add the spoilered posting step first.`);
  return spoiler;
}

/** The toot-card carrying the tag's SPOILER marker (the body marker is hidden
 *  while collapsed, so cards are located by the always-visible spoiler). */
function cardBySpoiler(page: Page, tag: string) {
  return page.locator('[data-testid="toot-card"]', { hasText: spoilerOf(tag) }).first();
}

// ── Spoilered (CW) statuses ──────────────────────────────────────────────────

When('{string} posts a spoilered status tagged {string} with a hidden body', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  const spoiler = uniqueMarker(`${tag}-spoiler`);
  const body = uniqueMarker(`${tag}-body`);
  await page.locator('[data-testid="compose-cw-toggle"]').click();
  await expect(page.locator('[data-testid="compose-cw-toggle"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-testid="compose-spoiler-input"]').fill(spoiler);
  await page.locator('[data-testid="compose-visibility"]').selectOption('public');
  await page.locator('[data-testid="mastodon-input"]').fill(body);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.locator('[data-testid="mastodon-post"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`posting the "${tag}" CW status failed: ${response.status()}`);
  const created = (await response.json()) as { id?: string; visibility?: string; spoiler_text?: string };
  // Honest oracle: the server must have accepted the spoiler as such.
  expect(created.spoiler_text, 'the server must echo the spoiler text').toBe(spoiler);
  spoilerByTag.set(tag, spoiler);
  statusRegistry.set(tag, { text: body, id: created.id ?? null, visibility: created.visibility ?? null });
});

Then(
  'the spoilered {string} status appears collapsed in the federated timeline of {string} within {int} seconds',
  async ({ user }, tag: string, username: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const spoiler = spoilerOf(tag);
    // Delivery poll on the SPOILER (the visible half)…
    await expect
      .poll(
        async () => {
          try {
            await page.goto('/social/mastodon/public', { waitUntil: 'domcontentloaded' });
            const feed = page.locator('[data-testid="mastodon-timeline"]');
            await feed.waitFor({ state: 'visible', timeout: 15_000 });
            await expect(feed).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
            return await page.locator('[data-testid="toot-card"]', { hasText: spoiler }).count();
          } catch {
            return 0;
          }
        },
        {
          message: `the spoilered "${tag}" status should reach ${username}'s federated timeline within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBeGreaterThan(0);
    // …then the COLLAPSED claim: the card shows the spoiler + Show more, and
    // the body marker is NOT in the rendered card at all.
    const card = cardBySpoiler(page, tag);
    await expect(card.locator('.cw-text')).toContainText(spoiler);
    await expect(card.locator('[data-testid="toot-cw-toggle"]')).toHaveText(/Show more/);
    await expect(card.locator('[data-testid="toot-cw-toggle"]')).toHaveAttribute('aria-expanded', 'false');
    await expect(card.locator('[data-testid="toot-content"]')).toHaveCount(0);
    expect(await card.textContent(), 'the hidden body must not leak into the collapsed card').not.toContain(
      statusOf(tag).text,
    );
  },
);

When('{string} expands the {string} content warning', async ({ user }, username: string, tag: string) => {
  const card = cardBySpoiler(pageOf(user(username).username), tag);
  await card.locator('[data-testid="toot-cw-toggle"]').click();
});

When('{string} collapses the {string} content warning', async ({ user }, username: string, tag: string) => {
  const card = cardBySpoiler(pageOf(user(username).username), tag);
  await card.locator('[data-testid="toot-cw-toggle"]').click();
});

Then('the {string} hidden body is visible to {string}', async ({ user }, tag: string, username: string) => {
  const card = cardBySpoiler(pageOf(user(username).username), tag);
  await expect(card.locator('[data-testid="toot-content"]')).toContainText(statusOf(tag).text, { timeout: 10_000 });
  await expect(card.locator('[data-testid="toot-cw-toggle"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('[data-testid="toot-cw-toggle"]')).toHaveText(/Show less/);
});

Then('the {string} hidden body is hidden again for {string}', async ({ user }, tag: string, username: string) => {
  const card = cardBySpoiler(pageOf(user(username).username), tag);
  await expect(card.locator('[data-testid="toot-content"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(card.locator('[data-testid="toot-cw-toggle"]')).toHaveAttribute('aria-expanded', 'false');
});

// ── Sensitive media (no spoiler) ─────────────────────────────────────────────

When('{string} seeds a sensitive image status tagged {string} through the compose API', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  if (page.url() === 'about:blank') await page.goto('/', { waitUntil: 'domcontentloaded' });
  const text = uniqueMarker(tag);
  const outcome = await page.evaluate<
    { error?: string; id?: string; visibility?: string; sensitive?: boolean; media?: number },
    string
  >(async (marker) => {
    // 1. A real PNG, generated in-page.
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx2d = canvas.getContext('2d')!;
    ctx2d.fillStyle = '#7c4dff';
    ctx2d.fillRect(0, 0, 16, 16);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    // 2. Upload through the cookie-authed hsproxy media endpoint.
    const form = new FormData();
    form.append('file', new File([blob], 'sensitive-e2e.png', { type: 'image/png' }));
    const upload = await fetch('/bff/user/mastodon/api/v2/media', {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!upload.ok && upload.status !== 202) return { error: `media upload failed: ${upload.status}` };
    const media = (await upload.json()) as { id?: string };
    if (!media.id) return { error: 'media upload returned no id' };
    // 3. The sensitive status — sensitive:true, NO spoiler_text (the defect
    //    surface: media-only blur with no CW header).
    const post = await fetch('/bff/user/mastodon/api/v1/statuses', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: marker, visibility: 'public', sensitive: true, media_ids: [media.id] }),
    });
    if (!post.ok) return { error: `status POST failed: ${post.status}` };
    const created = (await post.json()) as {
      id?: string;
      visibility?: string;
      sensitive?: boolean;
      media_attachments?: unknown[];
    };
    return {
      id: created.id,
      visibility: created.visibility,
      sensitive: created.sensitive,
      media: created.media_attachments?.length ?? 0,
    };
  }, text);
  if (outcome.error) throw new Error(`sensitive-status seed for "${tag}": ${outcome.error}`);
  // Honest oracle: sensitive must have round-tripped WITH the attachment.
  expect(outcome.sensitive, 'the server must mark the status sensitive').toBe(true);
  expect(outcome.media, 'the status must carry the uploaded attachment').toBeGreaterThan(0);
  statusRegistry.set(tag, { text, id: outcome.id ?? null, visibility: outcome.visibility ?? null });
});

Then(
  'the sensitive {string} media appears blurred with a {string} control in the federated timeline of {string} within {int} seconds',
  async ({ user }, tag: string, label: string, username: string, seconds: number) => {
    const page = pageOf(user(username).username);
    const text = statusOf(tag).text;
    await expect
      .poll(
        async () => {
          try {
            await page.goto('/social/mastodon/public', { waitUntil: 'domcontentloaded' });
            const feed = page.locator('[data-testid="mastodon-timeline"]');
            await feed.waitFor({ state: 'visible', timeout: 15_000 });
            await expect(feed).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
            return await page.locator('[data-testid="toot-card"]', { hasText: text }).count();
          } catch {
            return 0;
          }
        },
        {
          message: `the sensitive "${tag}" status should reach ${username}'s federated timeline within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBeGreaterThan(0);
    const card = page.locator('[data-testid="toot-card"]', { hasText: text }).first();
    // Sensitive-only semantics: the BODY stays visible (no spoiler), the MEDIA
    // is blurred, and the reveal control exists — the fixed defect.
    await expect(card.locator('[data-testid="toot-content"]')).toContainText(text);
    const img = card.locator('.toot-media img').first();
    await expect(img).toHaveClass(/sensitive/, { timeout: 10_000 });
    const toggle = card.locator('[data-testid="toot-cw-toggle"]');
    await expect(toggle, 'sensitive-only media MUST offer a reveal control (the fixed defect)').toBeVisible();
    await expect(toggle).toHaveText(new RegExp(label));
    await expect(card.locator('.cw-text')).toContainText('Sensitive content');
  },
);

When('{string} clicks the {string} control on the {string} status', async ({ user }, username: string, label: string, tag: string) => {
  const card = pageOf(user(username).username)
    .locator('[data-testid="toot-card"]', { hasText: statusOf(tag).text })
    .first();
  const toggle = card.locator('[data-testid="toot-cw-toggle"]');
  await expect(toggle).toHaveText(new RegExp(label));
  await toggle.click();
});

Then('the {string} media is revealed for {string}', async ({ user }, tag: string, username: string) => {
  const card = pageOf(user(username).username)
    .locator('[data-testid="toot-card"]', { hasText: statusOf(tag).text })
    .first();
  await expect(card.locator('.toot-media img').first()).not.toHaveClass(/sensitive/, { timeout: 10_000 });
  await expect(card.locator('[data-testid="toot-cw-toggle"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('[data-testid="toot-cw-toggle"]')).toHaveText(/Hide media/);
});
