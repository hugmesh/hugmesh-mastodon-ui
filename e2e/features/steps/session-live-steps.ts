// Offline SESSION-LIVE-CHANGE step definitions (session-live-change.feature) —
// mid-session role / domain-lock mutations delivered through the REAL
// production channel: a new hug.session in localStorage + the same-document
// 'hug-session-change' window event SessionService subscribes to (see
// session.service.ts — the channel name is a load-bearing contract; renaming
// it there fails these steps loudly). No reload is ever issued: every
// assertion that follows the broadcast proves the LIVE update.

import { expect, Page } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';

/** Same-document broadcast channel name — session.service.ts `channel`. */
const SESSION_CHANNEL = 'hug-session-change';
const SESSION_KEY = 'hug.session';

// ── Stubbed one-post home timeline (the actions menu needs a toot) ───────────

Given('the home timeline API is stubbed with one post', async ({ page }) => {
  const account = {
    id: 'live-acct-1',
    username: 'poster',
    acct: 'poster',
    url: 'https://example.test/@poster',
    display_name: 'Poster',
    note: '',
    avatar: '',
    avatar_static: '',
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
  const status = {
    id: 'live-status-1',
    uri: 'https://example.test/statuses/live-status-1',
    url: null,
    created_at: '2026-07-01T10:00:00.000Z',
    edited_at: null,
    content: '<p>a stubbed post for the live role-change scenarios</p>',
    visibility: 'public',
    sensitive: false,
    spoiler_text: '',
    language: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    account,
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
  await page.route('**/bff/user/mastodon/api/v1/timelines/home*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([status]) }),
  );
});

// ── Composer interaction ─────────────────────────────────────────────────────

When('{string} selects the {string} compose visibility', async ({ page }, username: string, visibility: string) => {
  void username; // single-page offline scenario — the default fixture page
  await page.locator('[data-testid="compose-visibility"]').first().selectOption(visibility);
});

// ── The live broadcast itself ────────────────────────────────────────────────

When('the session roles become {string} via the live broadcast', async ({ page }, roleCsv: string) => {
  const roles = roleCsv
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  await page.evaluate(
    ([key, channel, nextRoles]) => {
      const raw = window.localStorage.getItem(key as string);
      if (!raw) throw new Error(`no ${key} present to mutate — seed a session first`);
      const session = JSON.parse(raw) as { roles?: string[] };
      session.roles = nextRoles as string[];
      window.localStorage.setItem(key as string, JSON.stringify(session));
      // The production same-document channel — SessionService.set() dispatches
      // exactly this event after every write.
      window.dispatchEvent(new Event(channel as string));
    },
    [SESSION_KEY, SESSION_CHANNEL, roles] as const,
  );
});

// ── Live-consequence assertions (no reload anywhere) ─────────────────────────

Then('the composer visibility select reads {string} without a reload', async ({ page }, visibility: string) => {
  // ComposeBoxComponent.ngDoCheck's documented claim: a lock arriving via the
  // broadcast coerces an ALREADY-OPEN composer's federated selection.
  await expect(page.locator('[data-testid="compose-visibility"]').first()).toHaveValue(visibility, {
    timeout: 10_000,
  });
});
