# hugmesh-mastodon-ui — e2e (Playwright + playwright-bdd)

Gherkin-readable e2e harness for the **Mastodon/Akkoma social remote**. Copied
from the proven `hugmesh.games/e2e` pattern and mirrors the merged wave-2b-1
harnesses (`admin-ui#39`, `superadmin-appstore-ui#2`, `login-ui#19`). It is
**pure test code** in this `e2e/` directory — it does not touch the karma unit
build or any app code.

## Ships dark (wave 2b)

Every scenario that needs a live stack (the host shell serving the federated
remote + the login remote + `user-bff-api` / `mod-bff-api` + a homeserver) is
tagged **`@cluster`** at the feature level. The default Playwright config filters
those out (`tags: 'not @cluster'`), so the **default run requires no cluster**.
Eight features are tagged `@offline` instead (no `@cluster`): they stub their
backends in the browser and run in the default config, against `ng serve` (see
"Run the UNTAGGED offline lane" below). Today that is 54 of the 135 scenarios;
the other 81 are `@cluster`.

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
  - `platform-role-access.feature` — the `ROLE_MASTODON` platform gate
    (ALLOW vs DENY; see the note below) + the additive role-tier action menu
    (USER / MOD / ADMIN via `SessionService.isUser/isMod/isAdmin`). The ADMIN
    tier's decide action is wired to `admin-bff-api`'s real
    `POST /bff/admin/moderation/{id}/decide` endpoint (`AdminBffService`,
    shipped in mastodon-ui#36); the scenario's `sees the admin decide-effect
    disclosure` step asserts the real disclosure text on `admin-stub-note`
    (which no longer carries a `data-stub` attribute — removed once decide was
    wired). *Note:* the feature says the host bounces a session without
    `ROLE_MASTODON` to the login page. The host route (`social/mastodon` in the
    host shell's `src/app/app.routes.ts`) uses `registeredGuard`, which checks only
    that registration is complete; the seed `no-mastodon` persona is registered, so
    that guard would admit it, and a signed-in user the guard does refuse goes to
    `/home?denied=…`, not `/login`. `ROLE_MASTODON` is enforced by the gateway
    route-access rules and the user-bff hsproxy (`hasRole('MASTODON')`). The DENY
    scenario has not been run live; its expectation is unverified.
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

### Wave 2 — status actions, notifications, search, follow UI, USER-tier self-block

Coverage-gap wave targeting the areas the platform Gherkin gap map flagged as
missing: notifications, search, favourites/bookmarks, follow, status
boost/fav/reply/bookmark. Every area below was verified against the real
component/service source before a scenario was written for it (see each
`.feature`'s header comment for the specific source citation). Explore and
list creation were first skipped and are covered in wave 3; mute as a distinct
action was investigated and is still skipped — see "Known gaps" below.

- **`features/social/status-actions.feature`** — boost/favourite/bookmark/reply
  via the real toot-card action bar, always victim-creates-first (a different
  persona than the actor authored the target status). Boost is a reach action
  (the booster's own home timeline shows it; the author sees the real
  `reblogs_count` climb). Favourite/bookmark are PRIVATE-to-actor lists — every
  scenario pairs the ALLOW (the actor's own list carries it) with the DENY (no
  one else's list — including the post's own author — ever does). Reply posts a
  real child status, observed as a thread descendant and an incremented parent
  reply count.
- **`features/social/notifications.feature`** — cross-user delivery of the four
  types `NotificationsColumnComponent` renders (mention/favourite/reblog/
  follow), each triggered by a DIFFERENT persona than the recipient; the
  mention scenario pairs the ALLOW with a mailbox-isolation DENY (an uninvolved
  bystander's own inbox never carries it); plus the type-filter chips and
  dismiss/clear-all.
- **`features/social/search.feature`** — cross-user discovery scoped to what is
  reliably indexed on EVERY Mastodon/Akkoma deployment: an exact account handle
  and a hashtag used in a real post. Free-text status-content search is a
  disclosed gap (see below).
- **`features/social/follow.feature`** — the account-profile Follow button
  driven through a REAL click (not the raw-API seed helper other features use
  as a precondition), pairing the ALLOW (following grants home-timeline reach)
  with the DENY (unfollowing revokes it going forward) — proving the UI control
  itself, not just the relationship it produces.
- **`features/social/self-block.feature`** — the USER tier's self-block
  (`role-actions-menu.component.ts`) actually CLICKED with the honest envelope
  asserted, extending `platform-role-access.feature` (which only proved the
  control renders enabled) the same way `mod-consequences.feature` did for the
  MOD tier; plus the client-side "no instance to recommend" disabled-control
  guard for a local account.

### Wave 3 — direct messages, lists, explore, and the offline client-side lane

The remaining uncovered surfaces from the gap map (`conversations-column`,
`lists-index` + the `list` timeline source, `explore.component`) plus the first
UNTAGGED offline scenarios this harness ships. As before, every area was
verified against the real component/service source first (see each `.feature`
header for the citation).

- **`features/social/direct-messages.feature`** (`@cluster`) — Conversations /
  DirectTimeline (`conversations-column.component.ts`, `GET
  /api/v1/conversations`). A `direct` status from a DIFFERENT persona reaches
  the addressee's Conversations attributed to the real sender (the row embeds an
  author link to the sender's account), paired with a mailbox-scoping DENY (an
  un-addressed bystander's Conversations never carries it); plus the inline
  direct-reply composer — a REAL child status the step refuses to believe unless
  the POST response is `visibility=direct` + `in_reply_to_id` linked to the
  parent, then observed landing in the sender's own Conversations.
- **`features/social/lists.feature`** (`@cluster`) — the lists index
  (`lists-index.component.ts`) and the `list` timeline source. The list is now
  created through the REAL in-app control (fill the title, click "Create list",
  capture the created list's true id off the `POST /api/v1/lists` response); the
  index row then renders + links to the true `/lists/:id`, and a member the owner
  really follows (still API-seeded via `/lists/:id/accounts` — no add-to-list UI
  yet) posts a status observed in that list timeline.
- **`features/social/lists-create.feature`** (`@offline`, no `@cluster`) — the
  create-list control itself, run offline against the dev-shell `ng serve` (like
  `client-state.feature`). The empty-title guard disables the submit with NO
  backend; the add / reject scenarios `page.route`-stub the same-origin
  `/bff/user/mastodon/api/v1/lists` POST so the submit → append (new row + cleared
  input) and submit → announced-error (index unchanged) wiring is proven with no
  live homeserver.
- **`features/social/explore.feature`** (`@cluster`) — the trending Posts /
  Hashtags / News tabs. Asserts the DETERMINISTIC part the earlier wave left
  out: each tab drives its OWN endpoint (`/api/v1/trends/{statuses,tags,links}`,
  observed via a `waitForResponse` armed before the click, like `search.feature`)
  and swaps its panel. Trending CONTENT is still not asserted (non-deterministic).
- **`features/social/client-state.feature`** (`@offline`, no `@cluster`) — the first
  scenarios that run with NO backend, against the remote's dev-shell (`ng serve`,
  see below). Pure signal-driven client state: the Explore tab, Search type and
  Notification filter controls flip `aria-pressed` and swap the DOM panel/section
  they gate, and the Lists index renders its empty state. Each asserts a REAL
  transition that FAILS on a blank page; none needs a live stack, so they carry
  no `@cluster` tag and the default `not @cluster` config runs them.

### Later waves — audit-gap features

Each `.feature` header names the audit gap it closes and the source it was
checked against. Scenario counts in parentheses.

- **Offline, `@offline`** (run by the default config against `ng serve`):
  - `appearance-sweep.feature` (11) — every non-chat appearance control applies
    its root attribute, the full reset, and reload persistence.
  - `chat-theme-sweep.feature` (12) — every chat-theme value, 20 seeded
    pseudo-random combinations, the boundary combinations, reset, reload, and
    phone/tablet fit.
  - `media-cloak-offline.feature` (5) — the AI-cloak badge lifecycle with a
    stubbed BFF: capability probe, escape hatch, degraded and absent-worker
    outcomes, and the on/off toggle.
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
  - `content-warnings.feature` (2) — spoilered status and sensitive media seen by
    another user.
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
- **Explore trending CONTENT** (which item trends) — computed by the homeserver
  from real cross-account engagement over time; no seed hook makes a specific
  item trend deterministically in one run, so a content assertion would be flaky
  or vacuous. `explore.feature` covers the endpoint+panel wiring instead; the
  ranked content is left for a wave with a trending-seed fixture.
- **Status-content full-text search** — see `search.feature`'s header comment;
  environment-dependent on an optional search backend this wave cannot verify.
- **The add-to-list UI** — the create-list control now ships (covered by
  `lists-create.feature` offline + `lists.feature` `@cluster`), but there is still
  no UI to ADD an account to a list; `lists.feature` seeds the member via the real
  API (a legitimate precondition, like the follow seed) to exercise the list
  timeline. Building the add-member UI is the remaining product gap here.
- **Mute as a distinct action** — the UI only exposes `block` (self/server-wide/
  internal); the USER-tier "Block / mute on Mastodon" control IS the mute (covered
  by `self-block.feature`). There is no separate "mute" affordance to test.
## Run

```bash
npm install
npm run bdd          # bddgen + playwright test (needs browsers + a live stack for @cluster)
```

### Run the UNTAGGED offline lane against `ng serve` (no cluster)

The eight `@offline` features (`client-state`, `lists-create`,
`appearance-sweep`, `chat-theme-sweep`, `media-cloak-offline`,
`session-live-change`, `vn-chat-offline`, `voice-video-offline`) carry no
`@cluster` tag and need no backend — they drive the remote's **dev-shell** (the
app's `app.routes.ts` mounts the exposed Mastodon routes at the ROOT so the
federated remote is browsable standalone). Point the harness at `ng serve` and
the default `not @cluster` config runs exactly those scenarios:

```bash
# terminal 1 — from the repo root, serve the remote standalone
npm start                                    # ng serve mastodon → http://localhost:4202

# terminal 2 — run the offline scenarios against it
cd e2e && npm install
npx playwright install chromium
E2E_BASE_URL=http://localhost:4202 npx bddgen && \
E2E_BASE_URL=http://localhost:4202 npx playwright test
```

Note the dev-shell serves the routes at the ROOT (`/explore`, `/search`, …),
NOT the host mount (`/social/mastodon/...`); the offline steps navigate those
root paths on purpose, so this lane MUST use the `ng serve` base URL. The
default base URL, `https://host.docker.internal:8443` (the host front door),
is where the `@cluster` features run, and those root paths 404 there.

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

See `tests/helpers/roles.ts`. Two helpers open a session. `seedSession()` writes
the `hug.session` localStorage key directly (the shape `SessionService.set()`
writes), so the role-tier signals + the `mastodon_domainlocked` marker behave as
in production; it carries no `bff_` cookie, so it cannot pass a server-side gate.
`login()` drives the real login form on a live stack.

Passwords have no literal default. `passwordFor()` takes the first of: the
per-user variable named in the helper (`E2E_USER_PASSWORD`, `E2E_MOD_PASSWORD`,
…), `E2E_PASSWORD`, then the same keys in the run-state credentials file
(`$E2E_CREDENTIALS_FILE`, or a `.e2e-credentials` found by walking up from the
working directory). If none resolves it throws and names `make stack-seed`
(hugmesh-generator), which generates and writes them. Other variables:
`E2E_BASE_URL` (see above), `E2E_MASTODON_URL` (the raw public timeline in the
visibility scenarios; default `https://mastodon.hugmesh.net`), and
`E2E_<USERNAME>_ACCT` (a persona's `acct` handle when it is not the plain
username).
