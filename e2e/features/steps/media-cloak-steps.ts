// Offline AI-CLOAK MEDIA step definitions (media-cloak-offline.feature) — the
// composer's IMAGE file-picker path and the cloak badge lifecycle, fully
// deterministic with page.route stubs of the two backends the composer talks
// to:
//
//   /bff/user/media/capability      — the up-front worker probe (queried at
//                                     composer init, so every stub step runs
//                                     BEFORE the navigation step)
//   /bff/user/media/upload          — the poison-before-ingest route
//   /bff/user/media/status/{ref}    — the badge's 2s poll
//   …/api/v2/media                  — the direct hsproxy upload (the opt-out /
//                                     unavailable route)
//
// HONESTY NOTES:
//   - the ROUTING assertions read wire counters captured off the stubs — which
//     endpoint the upload REALLY hit, the exact contract the cloak exists for
//     (poison-before-ingest, never homeserver-first);
//   - badge claims assert the REAL rendered badgeText() copy verbatim;
//   - "no longer polled" watches the status counter across a window LONGER
//     than two of the component's 2-second poll ticks — a poll loop the escape
//     hatch failed to stop lands in that window and fails the assertion;
//   - the attached image is a REAL PNG (Playwright buffer), entering through
//     the REAL file input.

import { expect, Page } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { onScenarioReset } from './_registry';

/** Wire counters + stub knobs for the CURRENT scenario. */
const cloakState = {
  bffUploads: 0,
  hsUploads: 0,
  statusCalls: 0,
};
onScenarioReset(() => {
  cloakState.bffUploads = 0;
  cloakState.hsUploads = 0;
  cloakState.statusCalls = 0;
});

/** A minimal valid 1x1 PNG (the smallest real image bytes; the composer only
 *  cares about the MIME type, but a genuine PNG keeps the preview honest). */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const PREVIEW_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** The homeserver MediaAttachment half of every upload response. url is
 *  non-null so the composer never enters the processing poll. */
function mediaAttachment(id: string): Record<string, unknown> {
  return {
    id,
    type: 'image',
    url: `https://media.test/${id}/full.png`,
    preview_url: PREVIEW_DATA_URI,
    remote_url: null,
    description: null,
    blurhash: null,
    meta: null,
  };
}

function capabilityStub(page: Page, body: Record<string, unknown>): Promise<void> {
  return page.route('**/bff/user/media/capability', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

/** Stub the BFF poison upload + the status poll. The first status read answers
 *  `pending`; every later read answers `finalStatus` — `null` keeps it pending
 *  forever (the escape-hatch leg). */
async function bffUploadStub(page: Page, finalStatus: string | null): Promise<void> {
  await page.route('**/bff/user/media/upload', (route) => {
    cloakState.bffUploads += 1;
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...mediaAttachment('cloak-m1'),
        cloak: { ref: 'cloak-ref-1', status: 'pending', mode: 'glaze', backend: 'cuda' },
      }),
    });
  });
  await page.route('**/bff/user/media/status/*', (route) => {
    cloakState.statusCalls += 1;
    const status = finalStatus !== null && cloakState.statusCalls > 1 ? finalStatus : 'pending';
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ref: 'cloak-ref-1', status, mode: 'glaze', backend: 'cuda' }),
    });
  });
}

// ── Stub arrangement (all BEFORE the navigation step — the capability probe
//    fires at composer init) ─────────────────────────────────────────────────

Given('the cloak capability is stubbed as available with backend {string}', async ({ page }, backend: string) => {
  await capabilityStub(page, { available: true, backend, defaultMode: 'glaze', expectedTime: '~1 min' });
});

Given('the cloak capability is stubbed as unavailable', async ({ page }) => {
  await capabilityStub(page, { available: false, backend: 'none', defaultMode: 'glaze' });
});

Given('the cloak upload is stubbed to answer pending then report {string}', async ({ page }, finalStatus: string) => {
  const known = ['protected', 'degraded', 'failed'];
  if (!known.includes(finalStatus)) {
    throw new Error(`Unknown cloak decision "${finalStatus}" — use ${known.join(' | ')}.`);
  }
  await bffUploadStub(page, finalStatus);
});

Given('the cloak upload is stubbed to stay pending forever', async ({ page }) => {
  await bffUploadStub(page, null);
});

Given('the homeserver media upload is stubbed', async ({ page }) => {
  await page.route('**/api/v2/media', (route) => {
    cloakState.hsUploads += 1;
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mediaAttachment('hs-m1')),
    });
  });
});

// ── Attaching ────────────────────────────────────────────────────────────────

When('the visitor attaches a generated image to the composer', async ({ page }) => {
  await page
    .locator('[data-testid="compose-media-input"]')
    .first()
    .setInputFiles({ name: 'e2e-cloak.png', mimeType: 'image/png', buffer: TINY_PNG });
  // The pending-media item is the composer's own proof the upload response
  // landed (whichever route it took) — later steps assert WHICH route.
  await expect(page.locator('[data-testid="compose-media-item"]').first()).toBeVisible({ timeout: 15_000 });
});

// ── Routing assertions (wire counters, not UI inference) ─────────────────────

Then('the image upload went to the BFF poison route, not the homeserver', async ({}) => {
  expect(cloakState.bffUploads, 'the upload must ride /bff/user/media/upload').toBeGreaterThan(0);
  expect(cloakState.hsUploads, 'NOTHING may reach the homeserver route before poisoning').toBe(0);
});

Then('the image upload went to the homeserver route, not the BFF', async ({}) => {
  expect(cloakState.hsUploads, 'the upload must ride the direct …/api/v2/media route').toBeGreaterThan(0);
  expect(cloakState.bffUploads, 'the BFF poison route must NOT be used when off/unavailable').toBe(0);
});

// ── Badge lifecycle ──────────────────────────────────────────────────────────

const badge = (page: Page) => page.locator('[data-testid="compose-cloak-badge"]').first();

Then('the attachment badge reads {string}', async ({ page }, text: string) => {
  await expect(badge(page)).toContainText(text, { timeout: 10_000 });
});

Then('the attachment badge becomes {string} within {int} seconds', async ({ page }, text: string, seconds: number) => {
  // The component polls the decision every 2s; the stub answers the final
  // status from the second read, so the flip is provably driven by the poll.
  await expect(badge(page)).toContainText(text, { timeout: seconds * 1_000 });
});

Then('no escape hatch is offered once protection resolved', async ({ page }) => {
  await expect(page.locator('[data-testid="compose-cloak-escape"]')).toHaveCount(0, { timeout: 10_000 });
});

// ── Escape hatch ─────────────────────────────────────────────────────────────

When('the visitor clicks the cloak escape hatch', async ({ page }) => {
  await page.locator('[data-testid="compose-cloak-escape"]').first().click();
});

Then('the cloak status endpoint is no longer polled', async ({}) => {
  // The poll loop ticks every 2 seconds and re-checks cloakRef BEFORE each
  // fetch, so once the escape hatch cleared the ref NO further status request
  // may leave the browser. Watch the counter across a window longer than two
  // ticks: the predicate reports 'silent' only after the window elapses with
  // the counter unchanged — a stray poll flips it to 'polled-again' and the
  // assertion fails (honest negative, bounded, no bare sleep).
  const before = cloakState.statusCalls;
  const deadline = Date.now() + 5_000;
  await expect
    .poll(
      () => {
        if (cloakState.statusCalls > before) return 'polled-again';
        return Date.now() >= deadline ? 'silent' : 'waiting';
      },
      {
        message: 'the escape hatch must stop the status polling (no request after the click)',
        timeout: 15_000,
        intervals: [250, 500],
      },
    )
    .toBe('silent');
});

// ── Unavailability notice ────────────────────────────────────────────────────

Then('the posted-without-protection notice is announced', async ({ page }) => {
  const notice = page.locator('[data-testid="compose-cloak-unavailable"]');
  await expect(notice).toBeVisible({ timeout: 10_000 });
  // "Announced": a REAL live region carrying the honest copy.
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toHaveAttribute('aria-live', 'polite');
  await expect(notice).toContainText(
    'AI-cloak is unavailable on this server right now — your image was posted without protection.',
  );
});

// ── The AI-cloak default toggle (per-browser persistence) ────────────────────

const poisonToggle = (page: Page) => page.locator('[data-testid="compose-poison-toggle"]').first();

When('the visitor toggles AI-cloak off', async ({ page }) => {
  const toggle = poisonToggle(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true'); // default is ON — a real transition, not a no-op
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toContainText('AI-cloak: Off');
});

Then('the AI-cloak toggle still reads off', async ({ page }) => {
  // Post-reload: the OFF default must have come back from localStorage
  // (POISON_DEFAULT_KEY), not the in-memory signal.
  const toggle = poisonToggle(page);
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toContainText('AI-cloak: Off');
});
