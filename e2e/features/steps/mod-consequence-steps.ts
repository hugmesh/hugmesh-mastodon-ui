// Moderation-CONSEQUENCE step definitions — the honest-envelope contract for
// the mod-bff write endpoints plus the observable effects of a block/ban on
// timelines and the composer.
//
// ENVELOPE FACTS these steps assert (verified against mod-bff-api
// ModController):
//   - POST /bff/mod/block      → 200 ONLY when the external homeserver-admin
//     call really landed ("ok"); a STUBBED / degraded / breaker-open leg is a
//     202 with {external: 'stubbed' | 'degraded:...'}. The UI relays the leg
//     state VERBATIM, so the truthful-disclosure step accepts ANY of the real
//     envelope forms (ok|stubbed|degraded) and the CONSEQUENCE steps that
//     follow prove whether the leg actually landed — a shown "ok" without the
//     observed effect (or vice versa) fails the scenario. The MATRIX leg is
//     STUBBED BY DESIGN (tuwunel has no REST admin API) so it must NEVER show
//     success — pinned by the stubbed-envelope step below.
//   - POST/DELETE /bff/mod/ban and /bff/mod/domain-lock/{role}/{user} → ALWAYS
//     202 {state: 'pending-reconcile'} — the effect is asynchronous, so a
//     synchronous 200 "banned/locked" would be a lie. Consequence assertions
//     therefore POLL the real effect (proxy rejection / role marker) instead of
//     trusting the write.
//
// All steps live in @cluster features; bddgen still compiles them offline.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, statusRegistry, apiEnvelope } from './_registry';
import { SeedUser, bffToken, clearSession, login } from '../../tests/helpers/roles';
import { uniqueMarker } from '../../tests/helpers/social';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** Fire a same-origin JSON call carrying the actor's bffToken and capture the
 *  FULL envelope (status + parsed body) for the honesty assertions. */
async function captureEnvelope(
  page: import('@playwright/test').Page,
  method: 'POST' | 'DELETE',
  path: string,
  body: unknown,
): Promise<void> {
  if (page.url() === 'about:blank') await page.goto('/', { waitUntil: 'domcontentloaded' });
  const token = await bffToken(page);
  const result = await page.evaluate(
    async ({ m, url, t, payload }) => {
      const r = await fetch(url, {
        method: m,
        headers: {
          'Content-Type': 'application/json',
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
        credentials: 'include',
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const text = await r.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: r.status, body: parsed };
    },
    { m: method, url: path, t: token, payload: body },
  );
  apiEnvelope.status = result.status;
  apiEnvelope.body = result.body;
}

// ── Acting on a SPECIFIC status (not just "the first post") ──────────────────

When(
  '{string} opens the actions menu on the {string} status',
  async ({ user }, username: string, tag: string) => {
    const created = statusRegistry.get(tag);
    if (!created) throw new Error(`No status tagged "${tag}" was created in this scenario.`);
    const page = pageOf(user(username).username);
    const card = page.locator('[data-testid="toot-card"]', { hasText: created.text }).first();
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    const menu = card.locator('[data-testid="role-actions"]');
    await menu.locator('[data-testid="role-actions-trigger"]').click();
    await expect(menu.locator('[data-testid="role-actions-panel"]')).toBeVisible({ timeout: 15_000 });
  },
);

When(
  '{string} clicks the {string} control in the actions panel',
  async ({ user }, username: string, testid: string) => {
    // A REAL click on the open panel's control — the consequence scenarios must
    // exercise the wired action, not merely assert the button renders enabled.
    const page = pageOf(user(username).username);
    const panel = page.locator('[data-testid="role-actions-panel"]').first();
    await expect(panel).toBeVisible();
    await panel.locator(`[data-testid="${testid}"]`).click();
  },
);

Then('{string} sees the moderation outcome disclosed truthfully', async ({ user }, username: string) => {
  // The component renders the mod-bff result verbatim into its live region
  // ("… External: ok." / "… External: stubbed." / "… External: degraded:…").
  // "External: ok" is rendered ONLY off a 200 whose leg really landed (the
  // controller never answers 200 otherwise), so it is a LEGITIMATE outcome on
  // a wired Akkoma stack — this step therefore accepts any of the truthful
  // disclosure forms rather than forbidding "ok". What it proves: the operator
  // is told the external leg's REAL state (never a bare unqualified success,
  // never silence). Whether a shown "ok" is true is proven by the CONSEQUENCE
  // steps that follow (disappearance / proxy rejection): a degraded leg passes
  // here but honestly fails there; a landed leg must show "ok" AND the effect.
  // The MATRIX leg's never-ok invariant is pinned separately by the dedicated
  // stubbed-envelope scenario (matrix is stubbed by design).
  const page = pageOf(user(username).username);
  const outcome = page.locator('[data-testid="role-actions-outcome"]').first();
  await expect(outcome).toBeVisible({ timeout: 15_000 });
  await expect(outcome).toContainText(/External: (ok|stubbed|degraded)/i);
});

// ── mod-bff write envelopes (block / ban / domain-lock) ──────────────────────

When(
  '{string} requests a {string}-platform server block of {string}',
  async ({ user }, actor: string, platform: string, target: string) => {
    if (platform !== 'matrix' && platform !== 'mastodon') throw new Error(`Unknown platform "${platform}"`);
    const t: SeedUser = user(target);
    await captureEnvelope(pageOf(user(actor).username), 'POST', '/bff/mod/block', {
      platform,
      scope: 'user',
      target: t.username,
      reason: 'e2e mod-consequence wave',
    });
  },
);

Then('the block response is the honest stubbed envelope', async () => {
  // The Matrix leg is STUBBED BY DESIGN → the controller must answer 202 (never
  // 200 "blocked") and disclose external: 'stubbed'. Asserting the exact marker
  // means a future accidental fake-"ok" fails this test.
  expect(apiEnvelope.status, 'a stubbed external leg must be 202 pending, never 200').toBe(202);
  const body = apiEnvelope.body as { external?: string } | null;
  expect(body?.external, `body must disclose the stubbed leg, got ${JSON.stringify(apiEnvelope.body)}`).toMatch(
    /^stubbed$/i,
  );
});

When('{string} bans {string} from the mastodon platform', async ({ user }, actor: string, target: string) => {
  const t: SeedUser = user(target);
  await captureEnvelope(pageOf(user(actor).username), 'POST', '/bff/mod/ban', {
    platform: 'mastodon',
    target: t.username,
    reason: 'e2e mod-consequence wave',
    idempotencyKey: uniqueMarker('ban'),
  });
});

When('{string} removes the mastodon domain lock on {string}', async ({ user }, actor: string, target: string) => {
  const t: SeedUser = user(target);
  await captureEnvelope(
    pageOf(user(actor).username),
    'DELETE',
    `/bff/mod/domain-lock/ROLE_MASTODON_DOMAINLOCKED/${encodeURIComponent(t.username)}`,
    { idempotencyKey: uniqueMarker('unlock') },
  );
});

When('{string} reapplies the mastodon domain lock on {string}', async ({ user }, actor: string, target: string) => {
  const t: SeedUser = user(target);
  await captureEnvelope(
    pageOf(user(actor).username),
    'POST',
    `/bff/mod/domain-lock/ROLE_MASTODON_DOMAINLOCKED/${encodeURIComponent(t.username)}`,
    { reason: 'e2e re-lock housekeeping', idempotencyKey: uniqueMarker('relock') },
  );
});

Then('the moderation response is the honest pending-reconcile envelope', async () => {
  // Ban / domain-lock writes are DESIRED-STATE: the reconcile loop applies the
  // effect later, so the contract is ALWAYS 202 + a pending disclosure — a
  // synchronous 200 "done" would claim an effect that has not happened.
  expect(apiEnvelope.status, 'desired-state writes must be 202 pending-reconcile').toBe(202);
  expect(JSON.stringify(apiEnvelope.body)).toMatch(/pending/i);
});

// ── Consequences: the composer is really denied / the lock really clears ─────

Then(
  'the mastodon proxy rejects posts from {string} within {int} seconds',
  async ({ user }, username: string, seconds: number) => {
    // The ban is pending-reconcile — poll the REAL effect (the hsproxy POST is
    // refused once the suspension lands) instead of sleeping or trusting the
    // 202. Probe drafts are uniquely marked so a pre-reconcile success cannot
    // be mistaken for anything else.
    const page = pageOf(user(username).username);
    if (page.url() === 'about:blank') await page.goto('/', { waitUntil: 'domcontentloaded' });
    const token = await bffToken(page);
    await expect
      .poll(
        async () =>
          await page.evaluate(
            async ({ t, marker }) => {
              const r = await fetch('/bff/user/mastodon/api/v1/statuses', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(t ? { Authorization: `Bearer ${t}` } : {}),
                },
                credentials: 'include',
                body: JSON.stringify({ status: marker, visibility: 'private' }),
              });
              return r.status;
            },
            { t: token, marker: uniqueMarker('ban-probe') },
          ),
        {
          message: `the hsproxy should refuse ${username}'s posts once the ban reconciles`,
          timeout: seconds * 1_000,
          intervals: [3_000, 5_000],
        },
      )
      .toBeGreaterThanOrEqual(400);
  },
);

When('{string} attempts to post a status tagged {string}', async ({ user }, username: string, tag: string) => {
  // Submit WITHOUT asserting success — the following step asserts the announced
  // rejection. The marker is still registered so a (buggy) accepted post would
  // be traceable.
  const page = pageOf(user(username).username);
  const text = uniqueMarker(tag);
  statusRegistry.set(tag, { text, id: null, visibility: null });
  await page.locator('[data-testid="mastodon-input"]').fill(text);
  await page.locator('[data-testid="mastodon-post"]').click();
});

Then(
  '{string} sees the compose submit rejected with an announced error',
  async ({ user }, username: string) => {
    // The composer's server-rejection surface: role=alert + assertive so the
    // denial is ANNOUNCED (compose-box.component submitError) — a silent no-op
    // that looks like success would hide the ban from the user.
    const page = pageOf(user(username).username);
    const err = page.locator('[data-testid="compose-submit-error"]');
    await expect(err).toBeVisible({ timeout: 15_000 });
    await expect(err).toHaveAttribute('role', 'alert');
    await expect(err).toHaveAttribute('aria-live', 'assertive');
  },
);

// ── Domain-lock raw-API bypass (fail-closed beyond aria-disabled) ────────────

When(
  '{string} fires a raw public post tagged {string} through the compose API',
  async ({ user }, username: string, tag: string) => {
    // Bypass the (aria-disabled) UI entirely: submit visibility=public straight
    // at the hsproxy with the session token, exactly as a hostile client would.
    const page = pageOf(user(username).username);
    const text = uniqueMarker(tag);
    await captureEnvelope(page, 'POST', '/bff/user/mastodon/api/v1/statuses', {
      status: text,
      visibility: 'public',
    });
    const body = apiEnvelope.body as { id?: string; visibility?: string } | null;
    statusRegistry.set(tag, {
      text,
      id: body && typeof body === 'object' ? body.id ?? null : null,
      visibility: body && typeof body === 'object' ? body.visibility ?? null : null,
    });
  },
);

Then('the raw post is rejected or coerced to a non-federated visibility', async () => {
  // FAIL-CLOSED contract for a domain-locked author: the server must NOT create
  // a federated-reach status from a forced payload. Two honest outcomes exist
  // (both prove the claim; each branch is asserted exactly):
  //   - REJECTED: a 4xx denial (401/403/422), nothing created; or
  //   - COERCED: created, but the returned Status carries a NON-federated
  //     visibility (private/direct) — the MRF/proxy downgraded the reach.
  // A 2xx WITH public/unlisted visibility is the vulnerability and fails here.
  const status = apiEnvelope.status;
  if (status >= 200 && status < 300) {
    const body = apiEnvelope.body as { visibility?: string } | null;
    expect(
      body?.visibility,
      `server accepted the forced payload — the created status must be coerced non-federated, got ${JSON.stringify(
        apiEnvelope.body,
      )}`,
    ).toMatch(/^(private|direct)$/);
  } else {
    expect([401, 403, 422], `expected a fail-closed rejection, got ${status}`).toContain(status);
  }
});

Given(
  '{string} logs in freshly until the mastodon domain-lock marker clears within {int} seconds',
  async ({ user }, username: string, seconds: number) => {
    // Unlock is pending-reconcile AND the role marker only changes on a fresh
    // token — so poll the REAL signal: clear the session, run the live login,
    // and read the roles the BFF minted. Only when `mastodon_domainlocked` is
    // gone has the unlock provably landed end-to-end.
    const u: SeedUser = user(username);
    const page = pageOf(u.username);
    await expect
      .poll(
        async () => {
          try {
            await clearSession(page);
            await login(page, u);
            const raw = await page.evaluate(() => window.localStorage.getItem('snap.session'));
            const roles: string[] = raw ? (JSON.parse(raw).roles ?? []) : [];
            return roles.some((r) => r.toLowerCase().replace(/^role_/, '') === 'mastodon_domainlocked');
          } catch {
            return true; // login hiccup — still locked as far as we can prove
          }
        },
        {
          message: `the domain-lock marker on ${username} should clear once the unlock reconciles`,
          timeout: seconds * 1_000,
          intervals: [5_000, 10_000],
        },
      )
      .toBe(false);
  },
);
