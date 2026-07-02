# snapdragon-mastodon-ui — e2e (Playwright + playwright-bdd)

Gherkin-readable e2e harness for the **Mastodon/Akkoma social remote**. Copied
from the proven `snapdragon.games/e2e` pattern and mirrors the merged wave-2b-1
harnesses (`admin-ui#39`, `superadmin-appstore-ui#2`, `login-ui#19`). It is
**pure test code** in this `e2e/` directory — it does not touch the karma unit
build or any app code.

## Ships dark (wave 2b)

Every scenario that needs a live stack (the host shell serving the federated
remote + the login remote + `user-bff-api` / `mod-bff-api` + a homeserver) is
tagged **`@cluster`** at the feature level. The default Playwright config filters
those out (`tags: 'not @cluster'`), so the **default run requires no cluster**.

`@cluster` (a plain filter tag) is used deliberately instead of playwright-bdd's
reserved `@skip`: `@skip` removes a scenario from *generation* entirely, so it
could never be **discovered**; `@cluster` lets a no-filter `bddgen` +
`playwright test --list` generate and list every scenario (proving the Gherkin
compiles), while the default config keeps them dark. Un-skip a feature later by
dropping its `@cluster` tag once the env-test-build wiring lands.

## What it covers

The three coverage classes the test standard demands, grounded in this repo's
real surfaces (`mastodon.routes.ts`, `session.service.ts`,
`role-actions-menu.component.*`, `compose-box.component.*`):

- **USER-SITUATIONAL** (`features/social/`):
  - `platform-role-access.feature` — the `ROLE_MASTODON` host social guard
    (ALLOW vs DENY) + the additive role-tier action menu
    (USER / MOD / ADMIN via `SessionService.isUser/isMod/isAdmin`), with the
    ADMIN tier rendered-but-**STUBBED** (no admin-bff endpoint by design).
  - `domainlock-composer.feature` — the **disabled + helptext** surface: a
    domain-locked user's local-only toggle is `aria-disabled` + enforced and the
    public/unlisted visibility options are disabled with a why-helptext wired via
    `aria-describedby`.
- **MULTIUSER-SITUATIONAL** (`features/moderation/`) — the MOD/ADMIN server-wide
  moderation queue + server-wide block (affect everyone), refer-to-admin
  escalation, and the `/bff/mod/moderation` API ALLOW.
- **CROSS-USER ISOLATION** (`features/cross-user/`) — the role-tier invariant
  (a user never sees the MOD tier, a mod never sees the ADMIN tier) asserted with
  both identities live in their own contexts, plus cross-tenant / unauth API
  **DENY** (403/401, fail-closed) against the bff.
- **a11y** (`features/a11y/`) — skip-link → main focus, the named timeline
  landmark + `role="feed"`, the role-actions popup ARIA (haspopup/expanded +
  named group), Escape focus-restore to the trigger, and live-region outcome /
  over-length compose-error announcements.

### P2 wave — visibility, server-side domain-lock, moderation consequences

- **`features/social/post-visibility.feature`** — the Akkoma visibility matrix
  (public/unlisted/private/direct) proven by OBSERVATION across per-persona
  contexts: every scenario creates a real status (real id captured off the POST
  response), then observes it — or its honest absence, always after a positive
  control — from another user, a cross-domain session (`user-b` rides domain-B's
  homeserver via the BFF hsproxy) and the RAW unauthenticated public timeline
  (`E2E_MASTODON_URL`), incl. a follower-relationship seed via the real API.
- **`features/social/domainlock-serverside.feature`** — the force-local MRF
  verified behaviourally (local follower sees the locked user's post; a domain-B
  observer never does), the raw visibility=public bypass asserted fail-closed
  (rejected or coerced — a 2xx public status fails), and the unlock round-trip
  (202 pending-reconcile envelope → fresh-login poll until the marker clears →
  composer re-enables → cross-domain observation → re-lock housekeeping).
- **`features/moderation/mod-consequences.feature`** — moderation controls
  actually CLICKED with the honest envelope asserted (202/stubbed/degraded —
  the Matrix leg NEVER shows success by design; the mastodon leg is degraded on
  the dev substitute), plus the observable consequences: the victim's posts
  disappear for observers and the banned/blocked target's compose submit is
  rejected with an announced `role=alert` error.

Timeline/federation waits use the `expect.poll` helpers in
`tests/helpers/social.ts` (never a bare `waitForTimeout`); negative
observations re-check across full reload+`aria-busy` settle cycles and only run
after the same scenario proved delivery elsewhere.

## Run

```bash
npm install
npm run bdd          # bddgen + playwright test (needs browsers + a live stack for @cluster)
```

## Validate OFFLINE (no cluster, no browsers)

Proves the features compile and scenarios are discovered without a live stack —
the gate the PR validates:

```bash
npm install
npx bddgen                                   # compile every .feature → .features-gen/*.spec.js
npx playwright test --list                   # default config (not @cluster) — discovers the dark set

# Discover EVERY scenario (no filter) to prove all Gherkin parses:
#   set tags to '' (or use a no-filter validate config) then:
#   npx bddgen && npx playwright test --list
```

The CI `e2e:bdd` job (`.gitlab-ci.yml`, `allow_failure: true`, rules-restricted)
runs exactly this: `npm ci && npx bddgen` then a no-filter validate config +
`playwright test --list`, so it stays non-blocking and needs no cluster.

## Seed users

See `tests/helpers/roles.ts`. Sessions are seeded directly into the
`snap.session` localStorage key (the shape `SessionService.set()` writes), so the
role-tier signals + the `mastodon_domainlocked` marker behave exactly as in
production. Passwords default to `E2E_PASSWORD` (or `e2e-pass`); per-user env
overrides are listed in the helper.
