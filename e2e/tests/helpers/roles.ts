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
export type RoleKind =
  | 'superadmin'
  | 'admin'
  | 'mod'
  | 'user'
  | 'domainlocked'
  | 'no-mastodon'
  | 'signed-out';

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
  // ── Superadmin — the cross-domain infra control plane. Casdoor grants the
  //    'superadmin' role ALONGSIDE 'admin' (same convention as the merged
  //    admin-ui e2e catalogue), so the UI role-tier signals (isMod/isAdmin —
  //    which key off 'admin'/'mod' only) light up while the mod-bff-api's
  //    hasAnyRole('MOD','ADMIN','SUPERADMIN') chain + the DomainScope
  //    null-predicate admit them ACROSS brands. No `domain` tag on purpose.
  { username: 'superadmin', passwordEnv: 'E2E_SUPERADMIN_PASSWORD', provider: 'google', roles: ['mastodon', 'superadmin', 'admin'], kind: 'superadmin', registered: true },

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
  //    isolation scenarios assert their token cannot read domain-A's data, and
  //    the post-visibility matrix uses them as the CROSS-DOMAIN observer (their
  //    session rides domain-B's homeserver via the BFF hsproxy, so what they see
  //    is exactly what FEDERATED to domain-B).
  { username: 'user-b', passwordEnv: 'E2E_USER_B_PASSWORD', provider: 'discord', roles: ['mastodon'], kind: 'user', domain: 'domain-b', registered: true },

  // ── Second domain-A user — the SAME-DOMAIN observer for the post-visibility
  //    matrix (permalink positive controls need an observer on the SAME
  //    homeserver: status ids are instance-local, so a domain-B observer can
  //    never dereference a domain-A permalink) and the non-follower DENY leg of
  //    the private-visibility scenario.
  { username: 'user-c', passwordEnv: 'E2E_USER_C_PASSWORD', provider: 'discord', roles: ['mastodon'], kind: 'user', domain: 'domain-a', registered: true },

  // ── Dedicated moderation-consequence target — the account the mod-consequence
  //    scenarios server-wide-block / mastodon-ban. A SEPARATE persona so the
  //    destructive actions never poison user-a/user-b for the rest of the run.
  { username: 'user-victim', passwordEnv: 'E2E_VICTIM_PASSWORD', provider: 'google', roles: ['mastodon'], kind: 'user', domain: 'domain-a', registered: true },

  // ── Domain-locked user — carries `mastodon_domainlocked` (force-local MRF
  //    marker). The composer's local-only toggle is aria-disabled+ENFORCED and
  //    the public/unlisted visibility options are disabled+helptext'd (the real
  //    ALLOW-but-restricted disabled+helptext surface).
  { username: 'locked-user', passwordEnv: 'E2E_LOCKED_PASSWORD', provider: 'google', roles: ['mastodon', 'mastodon_domainlocked'], kind: 'domainlocked', domain: 'domain-a', registered: true },

  // ── No-Mastodon user — authenticated but WITHOUT ROLE_MASTODON. The host's
  //    social guard must DENY access to the social surface entirely. The
  //    platform-role-absent floor.
  { username: 'no-mastodon', passwordEnv: 'E2E_NOMASTO_PASSWORD', provider: 'google', roles: [], kind: 'no-mastodon', domain: 'domain-a', registered: true },

  // ── Signed-out visitor — NO session at all (the RBAC floor below every role).
  //    Registered in the catalogue so the {string}-keyed steps resolve the
  //    persona, but the `has a signed-out context` step NEVER seeds a session
  //    for it — the page carries no `snap.session` key. passwordEnv is a dummy;
  //    this persona must never log in.
  { username: 'signed-out', passwordEnv: 'E2E_PASSWORD', provider: 'google', roles: [], kind: 'signed-out', registered: false },
];

/**
 * The Mastodon `acct` handle other personas use to address/resolve `user` over
 * the homeserver API (follow seeding, direct-post mentions). Defaults to the
 * plain local username; a live multi-domain stack overrides it per user with
 * `E2E_<USERNAME>_ACCT` (dashes → underscores), e.g.
 * `E2E_USER_A_ACCT=user-a@social.domain-a.test` so a domain-B session can
 * webfinger-resolve the remote handle.
 */
export function acctFor(user: SeedUser): string {
  const env = `E2E_${user.username.toUpperCase().replace(/-/g, '_')}_ACCT`;
  return process.env[env] ?? user.username;
}

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
 * writes `snap.session` (see set()/broadcast()) and the BFF sets the HttpOnly
 * `bff_` cookie via Set-Cookie. We wait for the `snap.session` key to carry the
 * identity so a follow-up guarded navigation doesn't race the write — the
 * browser holds NO bearer of any kind post-cutover, so `bffToken` never appears.
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
        return Boolean(JSON.parse(raw).id);
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
 * needing the BFF. NOTE: this seeds ONLY the non-secret metadata — it carries
 * no HttpOnly `bff_` cookie, so a seeded (non-`login()`) session cannot pass the
 * server-side @PreAuthorize gates, only the client-side role-tier gating.
 */
export async function seedSession(page: Page, user: SeedUser): Promise<void> {
  const session = {
    id: `${user.provider}:${user.username}@example.test`,
    label: user.username,
    provider: user.provider,
    roles: user.roles,
    registrationComplete: user.registered ?? true,
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    ['snap.session', JSON.stringify(session)] as const,
  );
}

/** Clear the session — used between role swaps so a stale identity doesn't carry
 *  into the next scenario's guard check. */
export async function clearSession(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.removeItem('snap.session'));
}
