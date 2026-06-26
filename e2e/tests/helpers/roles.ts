import { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Catalogue of Casdoor seed users for the mastodon-ui e2e matrix. Adapted from
 * the proven snapdragon.games/e2e helper, but keyed to THIS app's session model:
 * the mastodon-ui (and its host) persist a {@link SnapSession} under the
 * `snap.session` localStorage key (see src/app/session.service.ts), whose
 * `roles: string[]` drives every role-tier signal — isUser / isMod / isAdmin —
 * and the social DOMAIN-LOCK marker (`mastodon_domainlocked`).
 *
 * The mastodon-ui is the federated SOCIAL surface (Mastodon/Akkoma), so the
 * catalogue exercises the THREE coverage classes the wave demands:
 *   - USER-SITUATIONAL  — each role-tiered action surface, ALLOW + DENY +
 *                         disabled+helptext (the domain-lock composer gate).
 *   - MULTIUSER         — a mod acting server-wide over the moderation queue.
 *   - CROSS-USER        — a plain user DENIED the MOD tier, a mod DENIED the
 *                         ADMIN tier, and a cross-tenant API DENY (403/404).
 *
 * The role tiers are ADDITIVE and the invariant is load-bearing: a MOD never
 * sees the ADMIN tier (isAdmin false for a plain mod) and a USER never sees the
 * MOD/ADMIN tier. ROLE_MASTODON is the platform access role gating the social
 * surface itself; a role-absent user is bounced by the host's social guard.
 *
 * The `kind` tag selects which role-specific assertions a feature drives. The
 * `domain` tag drives the cross-tenant isolation scenarios. Passwords default to
 * `process.env.E2E_PASSWORD` (or `e2e-pass`) unless a per-user override env var
 * is exported.
 */
export type RoleKind = 'admin' | 'mod' | 'user' | 'domainlocked' | 'no-mastodon';

export interface SeedUser {
  /** CLI-friendly username referenced from .feature lines. */
  username: string;
  /** env var the compose overlay routes the cred through. */
  passwordEnv: string;
  /** Identity provider — mastodon-ui sessions are google- or discord-backed. */
  provider: 'google' | 'discord';
  /** The lowercased Casdoor roles this user carries in `snap.session.roles`.
   *  `mastodon` = the ROLE_MASTODON platform access role (host social guard);
   *  `mastodon_domainlocked` = the force-local restriction marker. */
  roles: string[];
  /** Drives role-specific assertions. */
  kind: RoleKind;
  /** Brand/domain this user belongs to — used by the cross-tenant DENY specs. */
  domain?: string;
  /** Whether registration completed — the host unlocks the social remote only
   *  after `registrationComplete` (SessionService.fullyRegistered). */
  registered?: boolean;
}

export const SEED_USERS: SeedUser[] = [
  // ── Admin — carries the ADMIN tier (isAdmin). The ADMIN moderation-decision
  //    controls are RENDERED but STUBBED (no admin-bff endpoint by design); the
  //    admin still gets the MOD tier (isMod = mod OR admin).
  { username: 'admin-a', passwordEnv: 'E2E_ADMIN_PASSWORD', provider: 'google', roles: ['mastodon', 'admin'], kind: 'admin', domain: 'domain-a', registered: true },

  // ── Mod — the MOD tier (server-wide block + moderation queue + refer-up).
  //    isAdmin is FALSE, so the mod must NOT see the ADMIN tier — the cross-user
  //    invariant.
  { username: 'mod-a', passwordEnv: 'E2E_MOD_PASSWORD', provider: 'discord', roles: ['mastodon', 'mod'], kind: 'mod', domain: 'domain-a', registered: true },

  // ── Plain social user — ROLE_MASTODON only. Gets the USER tier (self-block +
  //    recommend-instance-block) but NEVER the MOD/ADMIN tiers. The DENY floor
  //    for the role-tiered action menu.
  { username: 'user-a', passwordEnv: 'E2E_USER_PASSWORD', provider: 'google', roles: ['mastodon'], kind: 'user', domain: 'domain-a', registered: true },

  // ── Domain-B user — a DIFFERENT brand, ROLE_MASTODON. The cross-tenant
  //    isolation scenarios assert their token cannot read domain-A's data.
  { username: 'user-b', passwordEnv: 'E2E_USER_B_PASSWORD', provider: 'discord', roles: ['mastodon'], kind: 'user', domain: 'domain-b', registered: true },

  // ── Domain-locked user — carries `mastodon_domainlocked` (force-local MRF
  //    marker). The composer's local-only toggle is aria-disabled+ENFORCED and
  //    the public/unlisted visibility options are disabled+helptext'd (the real
  //    ALLOW-but-restricted disabled+helptext surface).
  { username: 'locked-user', passwordEnv: 'E2E_LOCKED_PASSWORD', provider: 'google', roles: ['mastodon', 'mastodon_domainlocked'], kind: 'domainlocked', domain: 'domain-a', registered: true },

  // ── No-Mastodon user — authenticated but WITHOUT ROLE_MASTODON. The host's
  //    social guard must DENY access to the social surface entirely. The
  //    platform-role-absent floor.
  { username: 'no-mastodon', passwordEnv: 'E2E_NOMASTO_PASSWORD', provider: 'google', roles: [], kind: 'no-mastodon', domain: 'domain-a', registered: true },
];

/** Resolve a seed user's password — env override or `E2E_PASSWORD` fallback —
 *  without throwing on a missing env. */
export function passwordFor(user: SeedUser): string {
  return process.env[user.passwordEnv]
    ?? process.env['E2E_PASSWORD']
    ?? 'e2e-pass';
}

/**
 * Create a fresh browser context that trusts the e2e self-signed cert AND uses
 * the same baseURL as the playwright config. The default `browser.newContext()`
 * does NOT inherit project-level `use` options (Playwright design choice), so a
 * spec that opens a manual context misses `ignoreHTTPSErrors: true` and every
 * HTTPS request fails the cert check — the native-federation manifest fetch is
 * the first casualty. Specs that need multiple users in parallel (the cross-user
 * isolation matrix) MUST call this instead of `browser.newContext()`.
 */
export async function newE2eContext(browser: Browser): Promise<BrowserContext> {
  return await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: process.env.E2E_BASE_URL ?? 'https://host.docker.internal:8443',
  });
}

/**
 * Drive the federated login form and wait for `snap.session` in localStorage.
 *
 * @cluster-only — this helper hits a LIVE login remote + host shell, so it is
 * only exercised by scenarios tagged `@cluster` today (wave 2b ships dark). It
 * is written now so a later wave can un-tag a feature without rewriting steps.
 *
 * The host shell renders the login micro-frontend; on success the SessionService
 * writes `snap.session` (see set()/broadcast()). We wait for that key to carry a
 * `bffToken` so a follow-up guarded navigation doesn't race the write.
 */
export async function login(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // The login remote exposes its form via formControlName selectors (the public
  // selector contract shared across the Snapdragon UIs).
  await page.locator('input[formControlName="username"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.fill('input[formControlName="username"]', user.username);
  await page.fill('input[formControlName="password"]', passwordFor(user));
  await page.click('button.login-btn');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const raw = window.localStorage.getItem('snap.session');
      if (!raw) return false;
      try {
        return Boolean(JSON.parse(raw).bffToken);
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Seed a {@link SnapSession} directly into localStorage WITHOUT a Casdoor round
 * trip. Mirrors the shape SessionService.set() writes, so the role-tier signals
 * (isUser/isMod/isAdmin) and the mastodonDomainLocked signal behave exactly as
 * in production. Used by the offline/dark scenarios that assert pure client-side
 * gating (skip-link focus, role-tier visibility, disabled+helptext) without
 * needing the BFF — and by the live scenarios as a faster alternative to a full
 * login where the token is not exercised.
 */
export async function seedSession(page: Page, user: SeedUser): Promise<void> {
  const session = {
    id: `${user.provider}:${user.username}@example.test`,
    label: user.username,
    provider: user.provider,
    roles: user.roles,
    bffToken: `e2e-${user.username}-token`,
    registrationComplete: user.registered ?? true,
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    ['snap.session', JSON.stringify(session)] as const,
  );
}

/** Read the bffToken off `localStorage['snap.session']` so a step can call the
 *  user-/mod-bff directly via `page.evaluate(fetch)` for the API-level DENY
 *  checks. */
export async function bffToken(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const raw = window.localStorage.getItem('snap.session');
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as { bffToken?: string }).bffToken ?? null;
    } catch {
      return null;
    }
  });
}

/** Clear the session — used between role swaps so a stale identity doesn't carry
 *  into the next scenario's guard check. */
export async function clearSession(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.removeItem('snap.session'));
}
