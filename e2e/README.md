# hugmesh-mastodon-ui — e2e (Playwright + playwright-bdd)

A Gherkin-readable e2e harness for the **Mastodon/Akkoma social remote**. It is
copied from the `hugmesh.games/e2e` pattern and mirrors the wave-2b-1 harnesses
(`admin-ui#39`, `superadmin-appstore-ui#2`, `login-ui#19`). It is **pure test
code** in this `e2e/` directory. It does not touch the karma unit build or any
app code.

## Ships dark (wave 2b)

Every scenario that needs a live stack (the host shell serving the federated
remote, the login remote, `user-bff-api` / `mod-bff-api`, and a homeserver) is
tagged **`@cluster`** at the feature level. The default Playwright config filters
those out (`tags: 'not @cluster'`), so the **default run needs no cluster**.
Eight features carry `@offline` instead of `@cluster`. They stub their backends in
the browser and run in the default config against `ng serve` (see "Run the
UNTAGGED offline lane" below). That is 54 of the 135 scenarios; the other 81 are
`@cluster`.

`@cluster` is a plain filter tag, used on purpose instead of playwright-bdd's
reserved `@skip`. `@skip` removes a scenario from *generation*, so it could never
be **discovered**. With `@cluster`, a no-filter `bddgen` + `playwright test
--list` generates and lists every scenario, which proves the Gherkin compiles,
while the default config keeps them dark. To un-skip a feature, drop its
`@cluster` tag once the env-test-build wiring lands.

## What it covers

The three coverage classes the test standard demands, grounded in this repo's
real surfaces (`mastodon.routes.ts`, `session.service.ts`,
`role-actions-menu.component.*`, `compose-box.component.*`):

- **USER-SITUATIONAL** (`features/social/`):
  - `platform-role-access.feature` — the `ROLE_MASTODON` platform gate (ALLOW vs
    DENY; see the note below) and the additive role-tier action menu (USER / MOD /
    ADMIN via `SessionService.isUser/isMod/isAdmin`). The ADMIN tier's decide
    action is wired to `admin-bff-api`'s real
    `POST /bff/admin/moderation/{id}/decide` endpoint (`AdminBffService`, shipped
    in mastodon-ui#36). The scenario's `sees the admin decide-effect disclosure`
    step asserts the real disclosure text on `admin-stub-note`, which no longer
    carries a `data-stub` attribute (removed once decide was wired).
    *Note:* the feature says the host bounces a session without `ROLE_MASTODON`
    to the login page. The host route (`social/mastodon` in the host shell's
    `src/app/app.routes.ts`) uses `registeredGuard`, which checks only that
    registration is complete. The seed `no-mastodon` persona is registered, so
    that guard would admit it, and a signed-in user the guard does refuse goes to
    `/home?denied=…`, not `/login`. `ROLE_MASTODON` is enforced by the gateway
    route-access rules and the user-bff hsproxy (`hasRole('MASTODON')`). The DENY
    scenario has not been run live; its expectation is unverified.
  - `domainlock-composer.feature` — the **disabled + helptext** surface. A
    domain-locked user's local-only toggle is `aria-disabled` and enforced, and
    the public/unlisted visibility options are disabled, with a why-helptext
    wired through `aria-describedby`.
- **MULTIUSER-SITUATIONAL** (`features/moderation/`) — the MOD/ADMIN server-wide
  moderation queue and server-wide block (both affect everyone), refer-to-admin
  escalation, and the `/bff/mod/moderation` API ALLOW.
- **CROSS-USER ISOLATION** (`features/cross-user/`) — the role-tier invariant (a
  user never sees the MOD tier, a mod never sees the ADMIN tier), asserted with
  both identities live in their own contexts, plus cross-tenant and unauth API
  **DENY** (403/401, fail-closed) against the bff.
- **a11y** (`features/a11y/`) — skip-link → main focus, the named timeline
  landmark and `role="feed"`, the role-actions popup ARIA (haspopup/expanded and
  a named group), Escape focus-restore to the trigger, and live-region outcome and
  over-length compose-error announcements.

### P2 wave — visibility, server-side domain-lock, moderation consequences

- **`features/social/post-visibility.feature`** — the Akkoma visibility matrix
  (public/unlisted/private/direct), proven by OBSERVATION across per-persona
  contexts. Each scenario creates a real status (id captured off the POST
  response), then observes it, or its honest absence, always after a positive
  control. Observers: another user; a cross-domain session (`user-b` rides
  domain-B's homeserver through the BFF hsproxy); the RAW unauthenticated public
  timeline (`E2E_MASTODON_URL`). A follower seed goes through the real API.
- **`features/social/domainlock-serverside.feature`** — the force-local MRF
  verified by behaviour: a local follower sees the locked user's post, a domain-B
  observer never does. The raw visibility=public bypass is asserted fail-closed
  (rejected or coerced; a 2xx public status fails). The unlock round-trip runs a
  202 pending-reconcile envelope, a fresh-login poll until the marker clears, the
  composer re-enabling, a cross-domain observation, and re-lock housekeeping.
- **`features/moderation/mod-consequences.feature`** — moderation controls
  actually CLICKED, with the honest envelope asserted (202/stubbed/degraded). The
  Matrix leg NEVER shows success, by design; the mastodon leg is degraded on the
  dev substitute. It also checks the consequences: the victim's posts disappear
  for observers, and the banned or blocked target's compose submit is rejected
  with an announced `role=alert` error.

Timeline and federation waits use the `expect.poll` helpers in
`tests/helpers/social.ts`, never a bare `waitForTimeout`. Negative observations
re-check across full reload and `aria-busy` settle cycles, and run only after the
same scenario proved delivery elsewhere.

### Wave 2 — status actions, notifications, search, follow UI, USER-tier self-block

This wave covers areas the platform Gherkin gap map flagged: notifications,
search, favourites/bookmarks, follow, and status boost/fav/reply/bookmark. Each
area was checked against the real component and service source first (each
`.feature` header cites it). Explore and list creation were first skipped and are
covered in wave 3. Mute as a distinct action was investigated and is still
skipped; see "Known gaps" below.

- **`features/social/status-actions.feature`** — boost/favourite/bookmark/reply
  through the real toot-card action bar, always victim-creates-first (a different
  persona authored the target). Boost is a reach action: the booster's home
  timeline shows it and the author sees `reblogs_count` climb. Favourite and
  bookmark are PRIVATE to the actor, so each scenario pairs the ALLOW (the actor's
  own list carries it) with the DENY (no one else's list, the author's included,
  does). Reply posts a real child status, observed as a thread descendant and an
  incremented parent reply count.
- **`features/social/notifications.feature`** — cross-user delivery of the four
  types `NotificationsColumnComponent` renders (mention/favourite/reblog/follow),
  each triggered by a DIFFERENT persona than the recipient. The mention scenario
  pairs the ALLOW with a mailbox-isolation DENY (an uninvolved bystander's inbox
  never carries it). It also covers the type-filter chips and dismiss/clear-all.
- **`features/social/search.feature`** — cross-user discovery, limited to what
  every Mastodon/Akkoma deployment reliably indexes: an exact account handle and a
  hashtag used in a real post. Free-text status search is a disclosed gap (below).
- **`features/social/follow.feature`** — the account-profile Follow button driven
  by a REAL click, not the raw-API seed helper other features use as a
  precondition. It pairs the ALLOW (following grants home-timeline reach) with the
  DENY (unfollowing revokes it going forward), so it proves the UI control, not
  only the relationship.
- **`features/social/self-block.feature`** — the USER tier's self-block
  (`role-actions-menu.component.ts`) actually CLICKED, with the honest envelope
  asserted. It extends `platform-role-access.feature` (which only proved the
  control renders enabled) the way `mod-consequences.feature` did for the MOD
  tier, and covers the client-side "no instance to recommend" disabled-control
  guard for a local account.

### Wave 3 — direct messages, lists, explore, and the offline client-side lane

The remaining uncovered surfaces from the gap map (`conversations-column`,
`lists-index` and the `list` timeline source, `explore.component`), plus the first
offline scenarios. Each area was checked against the real source first (see each
`.feature` header).

- **`features/social/direct-messages.feature`** (`@cluster`) — Conversations /
  DirectTimeline (`conversations-column.component.ts`, `GET
  /api/v1/conversations`). A `direct` status from a DIFFERENT persona reaches the
  addressee's Conversations, attributed to the real sender (the row embeds an
  author link). It pairs with a mailbox-scoping DENY (an un-addressed bystander's
  Conversations never carries it). The inline direct-reply composer is covered
  too: a REAL child status, believed only if the POST response is
  `visibility=direct` with `in_reply_to_id` linked to the parent, then observed in
  the sender's own Conversations.
- **`features/social/lists.feature`** (`@cluster`) — the lists index
  (`lists-index.component.ts`) and the `list` timeline source. The list is created
  through the REAL in-app control: fill the title, click "Create list", capture
  the true id off the `POST /api/v1/lists` response. The index row then renders
  and links to the true `/lists/:id`. A member the owner really follows (still
  API-seeded through `/lists/:id/accounts`; there is no add-to-list UI yet) posts
  a status observed in that list timeline.
- **`features/social/lists-create.feature`** (`@offline`, no `@cluster`) — the
  create-list control itself, run offline against the dev-shell `ng serve` (like
  `client-state.feature`). The empty-title guard disables the submit with NO
  backend. The add and reject scenarios `page.route`-stub the same-origin
  `/bff/user/mastodon/api/v1/lists` POST, proving submit → append (new row,
  cleared input) and submit → announced-error (index unchanged) with no live
  homeserver.
- **`features/social/explore.feature`** (`@cluster`) — the trending Posts /
  Hashtags / News tabs. It asserts the DETERMINISTIC part the earlier wave left
  out: each tab drives its OWN endpoint (`/api/v1/trends/{statuses,tags,links}`,
  observed through a `waitForResponse` armed before the click, like
  `search.feature`) and swaps its panel. Trending CONTENT is still not asserted
  (non-deterministic).
- **`features/social/client-state.feature`** (`@offline`, no `@cluster`) — the
  first scenarios that run with NO backend, against the dev-shell (`ng serve`, see
  below). Pure signal-driven client state: the Explore tab, Search type and
  Notification filter controls flip `aria-pressed` and swap the panel or section
  they gate, and the Lists index renders its empty state. Each asserts a REAL
  transition that FAILS on a blank page. None needs a live stack, so none carries
  `@cluster` and the default `not @cluster` config runs them.

### Later waves — audit-gap features

Each `.feature` header names the audit gap it closes and the source it was
checked against. Scenario counts are in parentheses.

- **Offline, `@offline`** (run by the default config against `ng serve`):
  - `appearance-sweep.feature` (11) — every non-chat appearance control applies its
    root attribute; the full reset; reload persistence.
  - `chat-theme-sweep.feature` (12) — every chat-theme value, 20 seeded
    pseudo-random combinations, the boundary combinations, reset, reload, and
    phone and tablet fit.
  - `media-cloak-offline.feature` (5) — the AI-cloak badge lifecycle with a stubbed
    BFF: capability probe, escape hatch, degraded and absent-worker outcomes, and
    the on/off toggle.
  - `session-live-change.feature` (3) — a domain lock or a role change arriving
    mid-session through the session broadcast.
  - `vn-chat-offline.feature` (10) — VN chat mode over a `page.route`-stubbed
    conversation: navigation, every shipped scene and prop, reduced motion,
    keyboard and viewport behaviour.
  - `voice-video-offline.feature` (6) — the recorder state machine with a fake
    `MediaRecorder`/`getUserMedia`, including the 64 MiB refusal.
- **Live stack, `@cluster`:**
  - `appearance-org-default.feature` (2) — an admin's org default reaches a
    never-customised user and not a customised one.
  - `content-warnings.feature` (2) — a spoilered status and sensitive media, seen
    by another user.
  - `direct-messages-group.feature` (2) — a direct status that mentions two
    accounts reaches both; dropping a mention drops that account.
  - `follow-request.feature` (1) — following a locked account reads "Requested"
    until approved.
  - `polls.feature` (2) — single- and multiple-choice polls voted on by another
    user.
  - `reply-visibility-inheritance.feature` (2) — a reply from the thread view
    inherits followers-only or direct visibility.
  - `self-block-consequences.feature` (2) — a self-block hides the blocked
    account's posts and severs the relationship.
  - `vn-chat-mode.feature` (4) and `voice-video-messages.feature` (4) — VN chat
    mode and recorded voice/video messages between two users.
  - `moderation/escalation-chain.feature` (1) and `moderation/mod-queue.feature`
    (6) — recommend, refer and decide end to end, and the mod queue.

**Known gaps (investigated, deliberately not covered):**
- **Explore trending CONTENT** (which item trends). The homeserver computes it from
  real cross-account engagement over time, and no seed hook makes a specific item
  trend deterministically in one run, so a content assertion would be flaky or
  vacuous. `explore.feature` covers the endpoint and panel wiring instead. The
  ranked content waits for a wave with a trending-seed fixture.
- **Status-content full-text search** — see `search.feature`'s header comment. It
  depends on an optional search backend this wave cannot verify.
- **The add-to-list UI.** The create-list control now ships (covered by
  `lists-create.feature` offline and `lists.feature` `@cluster`), but there is
  still no UI to ADD an account to a list. `lists.feature` seeds the member
  through the real API (a legitimate precondition, like the follow seed) to
  exercise the list timeline. Building the add-member UI is the remaining product
  gap.
- **Mute as a distinct action.** The UI exposes only `block` (self/server-wide/
  internal). The USER-tier "Block / mute on Mastodon" control IS the mute (covered
  by `self-block.feature`). There is no separate "mute" affordance to test.

## Run

```bash
npm install
npm run bdd          # bddgen + playwright test (needs browsers + a live stack for @cluster)
```

### Run the UNTAGGED offline lane against `ng serve` (no cluster)

The eight `@offline` features (`client-state`, `lists-create`, `appearance-sweep`,
`chat-theme-sweep`, `media-cloak-offline`, `session-live-change`,
`vn-chat-offline`, `voice-video-offline`) carry no `@cluster` tag and need no
backend. They drive the remote's **dev-shell**: the app's `app.routes.ts` mounts
the exposed Mastodon routes at the ROOT, so the federated remote is browsable
standalone. Point the harness at `ng serve` and the default `not @cluster` config
runs exactly those scenarios:

```bash
# terminal 1 — from the repo root, serve the remote standalone
npm start                                    # ng serve mastodon → http://localhost:4202

# terminal 2 — run the offline scenarios against it
cd e2e && npm install
npx playwright install chromium
E2E_BASE_URL=http://localhost:4202 npx bddgen && \
E2E_BASE_URL=http://localhost:4202 npx playwright test
```

The dev-shell serves the routes at the ROOT (`/explore`, `/search`, …), NOT at the
host mount (`/social/mastodon/...`). The offline steps navigate those root paths
on purpose, so this lane MUST use the `ng serve` base URL. The default base URL,
`https://host.docker.internal:8443` (the host front door), is where the `@cluster`
features run, and those root paths 404 there.

## Validate OFFLINE (no cluster, no browsers)

This proves the features compile and the scenarios are discovered without a live
stack. It is the gate the PR validates:

```bash
npm install
npx bddgen                                   # compile every .feature → .features-gen/*.spec.js
npx playwright test --list                   # default config (not @cluster) — discovers the dark set

# Discover EVERY scenario (no filter) to prove all Gherkin parses:
#   set tags to '' (or use a no-filter validate config) then:
#   npx bddgen && npx playwright test --list
```

The CI `e2e:bdd` job (`.gitlab-ci.yml`, `allow_failure: true`, rules-restricted)
runs exactly this: `npm ci && npx bddgen`, then a no-filter validate config and
`playwright test --list`. It stays non-blocking and needs no cluster.

## Seed users

See `tests/helpers/roles.ts`. Two helpers open a session. `seedSession()` writes
the `hug.session` localStorage key directly (the shape `SessionService.set()`
writes), so the role-tier signals and the `mastodon_domainlocked` marker behave as
in production. It carries no `bff_` cookie, so it cannot pass a server-side gate.
`login()` drives the real login form on a live stack.

Passwords have no literal default. `passwordFor()` takes the first of these: the
per-user variable named in the helper (`E2E_USER_PASSWORD`, `E2E_MOD_PASSWORD`, …),
`E2E_PASSWORD`, then the same keys in the run-state credentials file
(`$E2E_CREDENTIALS_FILE`, or a `.e2e-credentials` found by walking up from the
working directory). If none resolves it throws and names `make stack-seed`
(hugmesh-generator), which generates and writes them. Other variables:
`E2E_BASE_URL` (see above), `E2E_MASTODON_URL` (the raw public timeline in the
visibility scenarios; default `https://mastodon.hugmesh.net`), and
`E2E_<USERNAME>_ACCT` (a persona's `acct` handle when it is not the plain
username).
