// Session / login / navigation step definitions backing the mastodon-ui
// features.
//
// Two flavours of "logged in":
//   - `Given "X" is logged in` / `has a seeded session (in their own context)`
//     — full login round-trip via login(), minting the HttpOnly bff_ cookie
//     (LIVE; only reached by @cluster scenarios in wave 2b — see the honesty
//     note above the step defs).
//   - `Given "X" has a seeded client-side session` — writes hug.session
//     directly via an addInitScript (OFFLINE; exercises ONLY the pure
//     client-side role-tier gating the social remote enforces via
//     SessionService.isUser/isMod/isAdmin — never a server read/write).
//
// The navigation steps assert the access outcome: the host's social guard
// either mounts the Mastodon remote (ALLOW → the mastodon-view renders) or
// bounces a ROLE_MASTODON-absent user to /login (DENY). All such steps live in
// @cluster features today because they need the host shell to be serving the
// remote; bddgen still compiles them so `--list` proves they parse.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry, responseState } from './_registry';
import {
  SeedUser,
  login,
  seedSession,
  clearSession,
  newE2eContext,
} from '../../tests/helpers/roles';

// ── Session priming ───────────────────────────────────────────────────────

Given('a clean session', async ({ page }) => {
  await clearSession(page);
});

Given('{string} is logged in', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  await login(page, u);
  pageRegistry.set(u.username, page);
});

// HONESTY FIX (audit: "@cluster write scenarios ride cookie-less seeded
// sessions"): BOTH cluster session-priming steps now run the REAL login round
// trip. Every feature that uses either step is @cluster-tagged (verified — the
// offline features use the visitor/"seeded client-side session" steps instead),
// and those scenarios read and WRITE through the cookie-authenticated hsproxy
// (`credentials: 'include'`), which a bare hug.session localStorage seed can
// never satisfy — seedSession()'s own docstring says it cannot pass the
// server-side @PreAuthorize gates. Seeding-then-writing violated the platform
// rule "real Casdoor sessions (HttpOnly bff_ cookie) for real writes": the
// moment the wave un-darkens, every write step would 401 at the transport.
// login() drives the live login remote and waits for hug.session — the
// Set-Cookie side effect mints the real bff_ cookie the write steps need. The
// step TEXT is kept so the 14 shipped features stay untouched; the offline
// alias below keeps seedSession available for pure client-side scenarios.

Given('{string} has a seeded session', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  await login(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded session in their own context', async ({ browser, user }, username: string) => {
  // Cross-user matrix: give each user an isolated context so two identities can
  // coexist in one scenario without sharing localStorage — each with a REAL
  // logged-in session (see the honesty note above).
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await login(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded client-side session', async ({ page, user }, username: string) => {
  // OFFLINE-ONLY session priming: writes hug.session via addInitScript with NO
  // Casdoor round trip and NO bff_ cookie. Legitimate ONLY for pure client-side
  // behaviour (role-tier rendering, the domain-lock composer gate, the session
  // broadcast) driven against the dev shell — never for a scenario that reads
  // or writes through the BFF. addInitScript must run BEFORE the first
  // navigation; the navigation step that follows picks the session up on load.
  const u: SeedUser = user(username);
  await seedSession(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} has a signed-out context', async ({ browser, user }, username: string) => {
  // The RBAC floor below every role: a persona with NO session at all. A fresh
  // isolated context, NO hug.session seeded — the host social guard and the
  // bff-apis must fail closed for it. Resolved through the catalogue (the
  // 'signed-out' seed user) so a feature typo still fails loudly.
  const u: SeedUser = user(username);
  if (u.kind !== 'signed-out') {
    throw new Error(`"${username}" is not the signed-out persona — use 'has a seeded session' instead.`);
  }
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

// ── Navigation ─────────────────────────────────────────────────────────────

When('{string} navigates to {string}', async ({ user }, username: string, path: string) => {
  const u: SeedUser = user(username);
  const page = pageRegistry.get(u.username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
});

// ── Access-outcome assertions (ROLE_MASTODON social guard) ──────────────────

Then('{string} sees the {string} view', async ({ user }, username: string, testid: string) => {
  // ALLOW: the host social guard admitted ROLE_MASTODON and the remote mounted;
  // the timeline column root carries data-testid="mastodon-view".
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('{string} is redirected to the login page', async ({ user }, username: string) => {
  // DENY: ROLE_MASTODON absent — the host social guard bounces to /login and the
  // social remote never mounts.
  const page = pageRegistry.get(user(username).username)!;
  await page.waitForURL(/\/login(\?|$)/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/login(\?|$)/);
});

Then('{string} does not see the {string} view', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
});

// ── API-level cross-user / cross-tenant DENY ────────────────────────────────
// The role-tiered menu is display-only; the user-/mod-bff is the real gate.
// These steps fire a same-origin fetch with `credentials: 'include'` so the
// HttpOnly `bff_` session cookie rides along (the gateway mints the Bearer
// server-side), exercising the actual bff-api @PreAuthorize + domain-scope
// chain, and capture the status. The cluster session steps above run the real
// login round trip, so the cookie is genuinely present — a 403 here is a true
// role/tenant DENY of an authenticated caller, not a disguised 401.

When('{string} GETs {string}', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  responseState.lastStatus = await page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return r.status;
  }, path);
});

When('{string} POSTs {string}', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  responseState.lastStatus = await page.evaluate(async (url) => {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return r.status;
  }, path);
});

When('the unauthenticated client GETs {string}', async ({ page }, path: string) => {
  await page.goto('/');
  responseState.lastStatus = await page.evaluate(async (p) => {
    const r = await fetch(p);
    return r.status;
  }, path);
});

Then('the response status is {int}', async ({}, expected: number) => {
  expect(responseState.lastStatus).toBe(expected);
});

Then('the response status is one of {int} or {int}', async ({}, a: number, b: number) => {
  expect([a, b]).toContain(responseState.lastStatus);
});
