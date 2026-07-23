// LIVE voice/video-message step definitions (voice-video-messages.feature) —
// closes the other half of the disclosed validate-gate gap (21 of the
// repo-wide 39 missing steps; see vn-chat-mode-steps.ts for the first 18).
//
// HONESTY CONTRACT implementation notes:
//   - capture is REAL: the "with fake media capture granted" session step
//     launches a DEDICATED Chromium instance with
//     `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, so a
//     genuine getUserMedia stream feeds a genuine MediaRecorder — no scripted
//     FakeMediaRecorder here (that lives in recorder-offline-steps.ts for the
//     offline state-machine feature) and no file ever enters through the
//     picker pretending to be a recording.
//   - the permission-denied variant launches WITH the fake device but WITHOUT
//     the fake-UI auto-grant: headless Chromium then denies the prompt, so the
//     component's real NotAllowedError → 'permission-denied' path runs.
//   - uploads are BELIEVED off the wire: a response listener armed at context
//     creation collects every POST to the media-upload endpoints (URL, status,
//     multipart filename, returned MIME type); the capture/DENY steps assert
//     that collection, never a preview element.
//   - "records for N seconds" waits on the composer's OWN mm:ss clock reaching
//     N (a bounded expect.poll over real UI state — not a sleep), so the take
//     provably spans the claimed duration.
//
// @cluster-only; bddgen still compiles these offline.

import { Browser, BrowserContext, Page, chromium, expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry, statusRegistry, CreatedStatus, onScenarioReset } from './_registry';
import { SeedUser, login } from '../../tests/helpers/roles';
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

/** Media-upload envelopes captured off the wire per page. Both ingest paths are
 *  watched: the plain hsproxy upload (/api/v2/media — the recorder's path; the
 *  cloak route is image-only) and the BFF poison route (/bff/user/media/upload)
 *  so a misrouted upload is caught, not missed. */
interface UploadEnvelope {
  url: string;
  status: number;
  filename: string | null;
  responseType: string | null;
}
const uploadsByPage = new WeakMap<Page, UploadEnvelope[]>();

function capturedUploads(page: Page): UploadEnvelope[] {
  const list = uploadsByPage.get(page);
  if (!list) throw new Error('The media-upload listener was not armed for this page (use the fake-capture session step).');
  return list;
}

/** The page whose composer is actively recording — set by every recorder
 *  action step so the subject-less "the composer …" assertions read the RIGHT
 *  persona's page even with several users registered in the scenario. */
let recorderPage: Page | null = null;
// Scenario-scoped: a stale page handle from the previous scenario is CLOSED
// and would defeat the "in this scenario" guard below.
onScenarioReset(() => {
  recorderPage = null;
});

function activeRecorderPage(): Page {
  if (!recorderPage) throw new Error('No recorder action has run yet in this scenario.');
  return recorderPage;
}

function armUploadListener(page: Page): void {
  const captured: UploadEnvelope[] = [];
  uploadsByPage.set(page, captured);
  page.on('response', (response) => {
    const req = response.request();
    if (req.method() !== 'POST') return;
    const url = response.url();
    if (!/\/api\/v2\/media$|\/bff\/user\/media\/upload$/.test(url)) return;
    // postData() returns null for binary bodies — decode the raw buffer
    // (latin1 keeps the multipart headers readable regardless of payload).
    const postData = req.postDataBuffer()?.toString('latin1') ?? req.postData() ?? '';
    const filenameMatch = postData.match(/filename="([^"]+)"/);
    void response
      .json()
      .then((body: { type?: string }) => {
        captured.push({ url, status: response.status(), filename: filenameMatch?.[1] ?? null, responseType: body?.type ?? null });
      })
      .catch(() => {
        captured.push({ url, status: response.status(), filename: filenameMatch?.[1] ?? null, responseType: null });
      });
  });
}

/** Launch a DEDICATED Chromium with real fake-capture devices for `username`,
 *  log them in for real (bff_ cookie), and register page/context under the
 *  usual keys. The extra browser process is tied to its context's close (the
 *  After hook closes every registered context), so nothing leaks. */
async function fakeCaptureSession(user: SeedUser, autoGrant: boolean): Promise<void> {
  const args = ['--use-fake-device-for-media-stream'];
  // WITH auto-grant: the permission prompt is auto-accepted and a real (tone /
  // rolling-pattern) stream records. WITHOUT it, headless Chromium denies the
  // prompt — the honest NotAllowedError leg.
  if (autoGrant) args.push('--use-fake-ui-for-media-stream');
  const browser: Browser = await chromium.launch({ args });
  const ctx: BrowserContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: process.env.E2E_BASE_URL ?? 'https://host.docker.internal:8443',
  });
  ctx.on('close', () => {
    void browser.close().catch(() => undefined);
  });
  const page = await ctx.newPage();
  recorderPage = null;
  armUploadListener(page);
  await login(page, user);
  ctxRegistry.set(user.username, ctx);
  pageRegistry.set(user.username, page);
}

Given(
  '{string} has a seeded session in their own context with fake media capture granted',
  async ({ user }, username: string) => {
    await fakeCaptureSession(user(username), true);
  },
);

Given(
  '{string} has a seeded session in their own context with microphone access blocked',
  async ({ user }, username: string) => {
    await fakeCaptureSession(user(username), false);
  },
);

// ── Opening the reply composer on a conversation ─────────────────────────────

When('{string} opens the reply composer on the {string} conversation', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  recorderPage = page;
  await page.goto('/social/mastodon/direct', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="conversations-column"]').waitFor({ state: 'visible', timeout: 15_000 });
  const row = page.locator('[data-testid="conversation-item"]', { hasText: statusOf(tag).text }).first();
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  const toggle = row.locator('[data-testid="conversation-reply-toggle"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });
  await row.locator('.conversation-reply').waitFor({ state: 'visible', timeout: 5_000 });
});

/** The active composer scope: the open conversation reply composer when one
 *  exists on the page, else the page's main composer (home timeline). */
function composerScope(page: Page) {
  return page
    .locator('.conversation-reply form.compose, form.compose')
    .first();
}

// ── Recording ────────────────────────────────────────────────────────────────

/** Bounded wait until the composer's own clock shows at least `seconds` —
 *  proves the take really spans the claimed duration (poll, not sleep). */
async function waitForElapsed(page: Page, seconds: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const text = await page.locator('[data-testid="compose-recorder-elapsed"]').textContent();
        const match = /^(\d{2}):(\d{2})$/.exec(text?.trim() ?? '');
        if (!match) return -1;
        return Number(match[1]) * 60 + Number(match[2]);
      },
      { timeout: (seconds + 30) * 1_000, intervals: [250, 500] },
    )
    .toBeGreaterThanOrEqual(seconds);
}

When('{string} starts recording a voice message', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  recorderPage = page;
  await composerScope(page).locator('[data-testid="compose-record-audio"]').click();
});

When('{string} starts recording a video message', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  recorderPage = page;
  await composerScope(page).locator('[data-testid="compose-record-video"]').click();
});

When('{string} records a voice message for {int} seconds and stops', async ({ user }, username: string, seconds: number) => {
  const page = pageOf(user(username).username);
  recorderPage = page;
  await composerScope(page).locator('[data-testid="compose-record-audio"]').click();
  await expect(page.locator('[data-testid="compose-recorder-status"]')).toBeVisible({ timeout: 10_000 });
  await waitForElapsed(page, seconds);
  await page.locator('[data-testid="compose-recorder-stop"]').click();
});

When('{string} stops the recording after {int} seconds and attaches the recorded take', async ({ user }, username: string, seconds: number) => {
  const page = pageOf(user(username).username);
  await waitForElapsed(page, seconds);
  await page.locator('[data-testid="compose-recorder-stop"]').click();
  const take = page.locator('[data-testid="compose-recorder-take"]');
  await take.waitFor({ state: 'visible', timeout: 15_000 });
  await take.locator('[data-testid="compose-recorder-attach"]').click();
});

When('{string} cancels the recording', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="compose-recorder-cancel"]').click();
  // Cancel tears the whole recorder panel down — nothing kept, nothing pending.
  await expect(page.locator('[data-testid="compose-recorder"]')).toHaveCount(0, { timeout: 10_000 });
});

When('{string} attaches the recorded take', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="compose-recorder-attach"]').click();
});

When('{string} discards the recorded take', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="compose-recorder-discard"]').click();
  await expect(page.locator('[data-testid="compose-recorder-take"]')).toHaveCount(0, { timeout: 10_000 });
});

// ── Recorder-state assertions ────────────────────────────────────────────────

Then('the composer shows a voice take preview with attach and discard controls', async ({}) => {
  const page = activeRecorderPage();
  const take = page.locator('[data-testid="compose-recorder-take"]');
  await expect(take).toBeVisible({ timeout: 15_000 });
  await expect(take.locator('[data-testid="compose-recorder-take-audio"]')).toBeVisible();
  await expect(take.locator('[data-testid="compose-recorder-attach"]')).toBeEnabled();
  await expect(take.locator('[data-testid="compose-recorder-discard"]')).toBeEnabled();
});

Then('the composer shows a muted live camera preview and a running mm:ss clock', async ({}) => {
  const page = activeRecorderPage();
  const live = page.locator('[data-testid="compose-recorder-live"]');
  await expect(live).toBeVisible({ timeout: 10_000 });
  expect(await live.evaluate((el) => (el as HTMLVideoElement).muted), 'the self-view must be muted').toBe(true);
  const elapsed = page.locator('[data-testid="compose-recorder-elapsed"]');
  await expect(elapsed).toHaveText(/^\d{2}:\d{2}$/, { timeout: 10_000 });
  // "Running": the clock must ADVANCE, not merely render 00:00.
  const before = (await elapsed.textContent())?.trim();
  await expect.poll(async () => (await elapsed.textContent())?.trim(), { timeout: 15_000 }).not.toBe(before);
});

Then('the composer shows a recorder status explaining access was denied', async ({}) => {
  const page = activeRecorderPage();
  const err = page.locator('[data-testid="compose-recorder-error"]');
  await expect(err).toBeVisible({ timeout: 15_000 });
  await expect(err).toHaveAttribute('aria-live', 'polite');
  await expect(err).toContainText(/denied/i);
});

Then('the composer shows no pending attachments', async ({}) => {
  const page = activeRecorderPage();
  await expect(page.locator('[data-testid="compose-media-item"]')).toHaveCount(0, { timeout: 10_000 });
});

// ── Wire-level upload capture / DENY ─────────────────────────────────────────

async function expectRealUpload(page: Page, kind: 'audio' | 'video', prefix: string): Promise<void> {
  await expect
    .poll(() => capturedUploads(page).length, {
      message: 'a media upload must be captured off the wire',
      timeout: 30_000,
      intervals: [500, 1_000],
    })
    .toBeGreaterThan(0);
  const last = capturedUploads(page)[capturedUploads(page).length - 1];
  expect([200, 202], `the media upload must be accepted, got ${last.status}`).toContain(last.status);
  expect(last.filename, `the multipart body must carry a ${prefix}* filename`).toMatch(new RegExp(`^${prefix}`));
  // The homeserver's own envelope must classify it as the right media kind — a
  // real MediaAttachment came back, not merely a 2xx.
  expect(last.responseType, `the server must classify the upload as ${kind}`).toBe(kind);
}

Then('a real audio media upload is captured with a {string} filename', async ({}, prefix: string) => {
  const page = activeRecorderPage();
  await expectRealUpload(page, 'audio', prefix);
});

Then('a real video media upload is captured with a {string} filename', async ({}, prefix: string) => {
  const page = activeRecorderPage();
  await expectRealUpload(page, 'video', prefix);
});

Then('no media upload request was issued', async ({}) => {
  const page = activeRecorderPage();
  // The preceding step already awaited the recorder UI settling back to idle
  // (panel/take removed), so any wrongly-fired upload would have been captured
  // by the response listener by now.
  expect(capturedUploads(page), 'NO upload may leave the browser for a cancel/discard/denied path').toHaveLength(0);
});

// ── Sending the reply and observing playback cross-user ──────────────────────

When('{string} sends the reply tagged {string}', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  const composer = composerScope(page);
  const text = uniqueMarker(tag);
  await composer.locator('[data-testid="mastodon-input"]').fill(text);
  // The attached take may still be processing server-side; the submit button
  // enables once the attachment settles — bounded wait on the REAL control.
  const submit = composer.locator('[data-testid="mastodon-post"]');
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await submit.click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`sending the "${tag}" reply failed: ${response.status()}`);
  const body = (await response.json()) as {
    id?: string;
    visibility?: string;
    media_attachments?: Array<{ type?: string }>;
  };
  expect(body.visibility, 'a conversation reply must post with direct visibility').toBe('direct');
  expect(
    body.media_attachments?.length ?? 0,
    'the posted reply must really carry the recorded attachment',
  ).toBeGreaterThan(0);
  statusRegistry.set(tag, { text, id: body.id ?? null, visibility: body.visibility ?? null });
});

async function expectPlayerInConversation(page: Page, tag: string, selector: string, label: string): Promise<void> {
  const text = statusOf(tag).text;
  await expect
    .poll(
      async () => {
        try {
          await page.goto('/social/mastodon/direct', { waitUntil: 'domcontentloaded' });
          await page.locator('[data-testid="conversations-column"]').waitFor({ state: 'visible', timeout: 15_000 });
          const row = page.locator('[data-testid="conversation-item"]', { hasText: text }).first();
          if ((await row.count()) === 0) return 0;
          return await row.locator(selector).count();
        } catch {
          return 0;
        }
      },
      { message: `the "${tag}" conversation row must render ${label}`, timeout: 90_000, intervals: [2_000, 3_000, 5_000] },
    )
    .toBeGreaterThan(0);
}

Then('the {string} status renders an audio player for {string}', async ({ user }, tag: string, username: string) => {
  const page = pageOf(user(username).username);
  await expectPlayerInConversation(page, tag, '.toot-media audio[controls]', 'an <audio controls> player');
});

Then('the {string} status renders a video player for {string}', async ({ user }, tag: string, username: string) => {
  const page = pageOf(user(username).username);
  await expectPlayerInConversation(page, tag, '.toot-media video[controls]', 'a <video controls> player');
});

// ── Fail-soft floor: plain text still posts ──────────────────────────────────

Then('{string} can still submit a plain text status tagged {string}', async ({ user }, username: string, tag: string) => {
  const page = pageOf(user(username).username);
  const composer = composerScope(page);
  const text = uniqueMarker(tag);
  await composer.locator('[data-testid="mastodon-input"]').fill(text);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await composer.locator('[data-testid="mastodon-post"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`posting the "${tag}" status failed: ${response.status()}`);
  const body = (await response.json()) as { id?: string; visibility?: string };
  statusRegistry.set(tag, { text, id: body.id ?? null, visibility: body.visibility ?? null });
});
