// Offline RECORDER step definitions (voice-video-offline.feature).
//
// The composer's recorder state machine is driven headless via addInitScript:
// a scripted FakeMediaRecorder + a getUserMedia that resolves a REAL (empty)
// MediaStream are installed BEFORE any app script runs, so the component's
// feature-detect, the srcObject self-view wiring and both stop paths behave
// exactly as with live devices — with deterministic bytes. The oversized-take
// scenario tells the fake to emit a >64 MiB blob so the composer's attach
// guard (MAX_RECORDED_UPLOAD_BYTES) is exercised for real.
//
// Every upload that would leave the browser is captured by a page.route on the
// hsproxy media path; the DENY scenarios assert the capture list stayed empty.

import { expect, Page } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';

const MEDIA_API = '**/bff/user/mastodon/api/v2/media';

/** Per-page capture of media upload request bodies (multipart text). */
const uploads = new WeakMap<Page, string[]>();

function capturedUploads(page: Page): string[] {
  const list = uploads.get(page);
  if (!list) throw new Error('The media upload API stub was not armed for this page.');
  return list;
}

/** The init script installing the fake capture pipeline. `oversized` is read
 *  at STOP time from window.__fakeRecorderOversized, so a later evaluate can
 *  flip it per scenario. `deny` makes getUserMedia refuse like a user denying
 *  the permission prompt. */
function fakeCaptureScript(deny: boolean): string {
  return `
    (() => {
      window.__fakeRecorderOversized = false;
      const denied = ${JSON.stringify(deny)};
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () =>
            denied
              ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
              : Promise.resolve(new MediaStream()),
        },
      });
      class FakeMediaRecorder {
        static isTypeSupported() { return true; }
        constructor(stream, options) {
          this.stream = stream;
          this.mimeType = (options && options.mimeType) || 'audio/webm';
          this.state = 'inactive';
          this.ondataavailable = null;
          this.onstop = null;
        }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          // 64 MiB + 1 for the guard scenario; a small deterministic chunk otherwise.
          const bytes = window.__fakeRecorderOversized ? 64 * 1024 * 1024 + 1 : 2048;
          if (this.ondataavailable) {
            this.ondataavailable({ data: new Blob([new ArrayBuffer(bytes)], { type: this.mimeType }) });
          }
          if (this.onstop) this.onstop();
        }
      }
      window.MediaRecorder = FakeMediaRecorder;
    })();
  `;
}

// ── Setup ────────────────────────────────────────────────────────────────────

Given('the media upload API is stubbed', async ({ page }) => {
  const captured: string[] = [];
  uploads.set(page, captured);
  await page.route(MEDIA_API, (route) => {
    captured.push(route.request().postData() ?? '');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `stub-media-${captured.length}`,
        type: 'audio',
        url: 'https://example.test/stub-media.webm', // non-null → no processing poll
        preview_url: null,
        remote_url: null,
        description: null,
        blurhash: null,
        meta: null,
      }),
    });
  });
});

Given('fake media capture is installed', async ({ page }) => {
  await page.addInitScript(fakeCaptureScript(false));
});

Given('fake media capture is installed but permission is denied', async ({ page }) => {
  await page.addInitScript(fakeCaptureScript(true));
});

Given('the fake recorder will produce an oversized take', async ({ page }) => {
  // Flips the flag the fake reads at stop() time (works pre- or post-load).
  await page.addInitScript('window.__fakeRecorderOversized = true;');
  await page.evaluate('window.__fakeRecorderOversized = true;').catch(() => undefined);
});

// ── Recording flow ───────────────────────────────────────────────────────────

When('the visitor starts a voice recording', async ({ page }) => {
  await page.locator('[data-testid="compose-record-audio"]').click();
});

When('the visitor starts a video recording', async ({ page }) => {
  await page.locator('[data-testid="compose-record-video"]').click();
});

Then('the voice record button reads pressed', async ({ page }) => {
  await expect(page.locator('[data-testid="compose-record-audio"]')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 10_000,
  });
});

Then('the video record button reads pressed', async ({ page }) => {
  await expect(page.locator('[data-testid="compose-record-video"]')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 10_000,
  });
});

Then('the recorder status announces a running voice recording with a clock', async ({ page }) => {
  const status = page.locator('[data-testid="compose-recorder-status"]');
  await expect(status).toBeVisible({ timeout: 10_000 });
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toContainText('Recording voice message');
  await expect(page.locator('[data-testid="compose-recorder-elapsed"]')).toHaveText(/^\d{2}:\d{2}$/, {
    timeout: 10_000,
  });
});

Then('a muted live camera preview is shown', async ({ page }) => {
  const live = page.locator('[data-testid="compose-recorder-live"]');
  await expect(live).toBeVisible({ timeout: 10_000 });
  expect(await live.evaluate((el) => (el as HTMLVideoElement).muted)).toBe(true);
});

Then('the live camera preview fits the viewport', async ({ page }) => {
  const live = page.locator('[data-testid="compose-recorder-live"]');
  await expect(live).toBeVisible({ timeout: 10_000 });
  const box = (await live.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
});

// Stop/Cancel are pressed via the KEYBOARD (focus + Enter) so every run also
// proves the controls are reachable and operable without a pointer while a
// recording is live.
When('the visitor stops the recording with the keyboard', async ({ page }) => {
  const stop = page.locator('[data-testid="compose-recorder-stop"]');
  await stop.focus();
  await expect(stop).toBeFocused();
  await page.keyboard.press('Enter');
});

When('the visitor cancels the recording with the keyboard', async ({ page }) => {
  const cancel = page.locator('[data-testid="compose-recorder-cancel"]');
  await cancel.focus();
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Enter');
});

// ── Take preview / attach / discard ──────────────────────────────────────────

Then('a voice take preview offers attach and discard', async ({ page }) => {
  const take = page.locator('[data-testid="compose-recorder-take"]');
  await expect(take).toBeVisible({ timeout: 10_000 });
  await expect(take.locator('[data-testid="compose-recorder-take-audio"]')).toBeVisible();
  await expect(take.locator('[data-testid="compose-recorder-attach"]')).toBeEnabled();
  await expect(take.locator('[data-testid="compose-recorder-discard"]')).toBeEnabled();
});

Then('a video take preview offers attach and discard', async ({ page }) => {
  const take = page.locator('[data-testid="compose-recorder-take"]');
  await expect(take).toBeVisible({ timeout: 10_000 });
  await expect(take.locator('[data-testid="compose-recorder-take-video"]')).toBeVisible();
  await expect(take.locator('[data-testid="compose-recorder-attach"]')).toBeEnabled();
});

When('the visitor attaches the take', async ({ page }) => {
  await page.locator('[data-testid="compose-recorder-attach"]').click();
});

When('the visitor discards the take', async ({ page }) => {
  await page.locator('[data-testid="compose-recorder-discard"]').click();
});

Then('a media upload request carries a {string} filename', async ({ page }, prefix: string) => {
  await expect.poll(() => capturedUploads(page).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const body = capturedUploads(page)[capturedUploads(page).length - 1];
  expect(body, `the multipart body must carry a ${prefix}* filename`).toContain(`filename="${prefix}`);
});

Then('a pending attachment row appears in the composer', async ({ page }) => {
  await expect(page.locator('[data-testid="compose-media-item"]')).toHaveCount(1, { timeout: 10_000 });
});

Then('no media upload request was issued offline', async ({ page }) => {
  // Settle one macro-turn so a wrongly-fired upload would have been captured.
  await page.waitForTimeout(250);
  expect(capturedUploads(page).length).toBe(0);
});

Then('the composer shows no pending attachment rows', async ({ page }) => {
  await expect(page.locator('[data-testid="compose-media-item"]')).toHaveCount(0, { timeout: 10_000 });
});

// ── 64 MiB guard ─────────────────────────────────────────────────────────────

Then('the oversized-take refusal is announced politely', async ({ page }) => {
  const err = page.locator('[data-testid="compose-take-error"]');
  await expect(err).toBeVisible({ timeout: 10_000 });
  await expect(err).toHaveAttribute('aria-live', 'polite');
  await expect(err).toHaveAttribute('role', 'status');
  await expect(err).toContainText('64 MiB');
});

Then('the take preview is still available to discard', async ({ page }) => {
  await expect(page.locator('[data-testid="compose-recorder-take"]')).toBeVisible();
  await expect(page.locator('[data-testid="compose-recorder-discard"]')).toBeEnabled();
});

// ── Permission-denied fail-soft ──────────────────────────────────────────────

Then('the recorder explains that access was denied', async ({ page }) => {
  const err = page.locator('[data-testid="compose-recorder-error"]');
  await expect(err).toBeVisible({ timeout: 10_000 });
  await expect(err).toHaveAttribute('aria-live', 'polite');
  await expect(err).toContainText(/denied/i);
});

Then('the compose textarea still accepts input', async ({ page }) => {
  const input = page.locator('[data-testid="mastodon-input"]').first();
  await input.fill('still fully usable');
  await expect(input).toHaveValue('still fully usable');
});
