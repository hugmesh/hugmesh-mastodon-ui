# snapdragon-mastodon-ui

The **Mastodon** Angular micro-frontend (native-federation **remote**) for the
[snapdragon.systems](https://github.com/Snapdragon-Systems/snapdragon.systems)
host shell. Federated into the host at runtime and served at `/social/mastodon`
by the `snapdragon-fe-gateway` (Spring Cloud Gateway) on the frontend Pi nodes.

Part of the Snapdragon RPi 5 / x86_64 cluster built by
[catalyst-scripts](https://github.com/Snapdragon-Systems/catalyst-scripts).
The sibling remotes live in their own repos:
[matrix/social](https://github.com/Snapdragon-Systems/snapdragon-social-ui) ·
[login](https://github.com/Snapdragon-Systems/snapdragon-login-ui) ·
[user](https://github.com/Snapdragon-Systems/snapdragon-user-ui) ·
[mod](https://github.com/Snapdragon-Systems/snapdragon-mod-ui) ·
[admin](https://github.com/Snapdragon-Systems/snapdragon-admin-ui).

## What this remote is

An Angular 22 + `@angular-architects/native-federation` single-project workspace
(project `mastodon`, root `.`, sourceRoot `src`, prefix `snap-mastodon`).

- **Remote name:** `mastodon`
- **Exposed federation module:** `./routes` → **`MASTODON_ROUTES`**
  (`src/app/mastodon.routes.ts`)

The host loads it via `loadRemoteModule('mastodon', './routes')` and mounts the
routes under `/social/mastodon`. The remote name + the `./routes` key are the
contract the host's `loadRemoteModule()` depends on — they are kept stable. The
federation surface (shared singletons, `strictVersion`, the RxJS skip list) is
centralised in `federation-base.js` (`snapdragonRemote()`), copied verbatim from
the snapdragon.systems reference so this remote can't drift from the host or the
sibling remotes; `federation.config.js` only declares the name + `exposes`.

`src/app/app.component.ts` (`snap-mastodon-root`) is a small standalone dev shell
used only when the remote runs on its own (`ng serve mastodon`); in production
the host federates `./routes` directly and the shell is not loaded.

### Architecture & data flow

The host federates `./routes`; the fe-gateway serves the remote bundle and the
remote calls the Mastodon API (per-service token, via the be-gateway) and the
same-origin BFFs (shared `bffToken`). The dashed red node is the only
roadmap item touching this flow — moving tokens off `localStorage`:

```mermaid
flowchart TD
    host["snapdragon.systems host shell"]
    host -->|"loadRemoteModule('mastodon', './routes')"| remote

    subgraph remote["mastodon remote (this repo)"]
        routes["MASTODON_ROUTES"]
        session["SessionService<br/>(snap.session in localStorage)"]
        masto["MastodonService"]
        compose["ComposeBoxComponent<br/>(domain-lock coerce-to-private)"]
        rolemenu["RoleActionsMenuComponent"]
    end

    feGw["fe-gateway (/social/mastodon)"]
    beGw["be-gateway"]
    mastoApi["Mastodon REST API"]
    userBff["user-bff-api (/bff/user/**)"]
    modBff["mod-bff-api (/bff/mod/**)"]
    adminBff["admin-bff-api"]
    casdoor["Casdoor (id.snapdragon.systems)"]

    feGw -->|"serves remoteEntry.json + CORS"| remote
    masto -->|"Bearer snap.session.mastodon.token"| beGw --> mastoApi
    rolemenu -->|"bffToken Bearer"| userBff
    rolemenu -->|"bffToken Bearer"| modBff
    compose -->|"AI-cloak media proxy + bffToken"| userBff
    adminBff -.->|"MASTODON_DOMAINLOCKED marker"| session
    casdoor -->|"per-service token via login remote"| session

    roadmap["Planned: move bearer + session<br/>off localStorage"]:::planned
    roadmap -.->|"platform security backlog"| session

    classDef planned stroke-dasharray:4,stroke:#b00,color:#b00
```

## Routes / key components

All routes are children of `MASTODON_ROUTES`, mounted by the host at
`/social/mastodon/...`:

| Path | Component | Notes |
| --- | --- | --- |
| `''`, `home` | `MastodonTimelineComponent` | home timeline + top composer |
| `local` | `MastodonTimelineComponent` | `data.source: community` (local public) |
| `public` | `MastodonTimelineComponent` | federated public |
| `tags/:tag` | `MastodonTimelineComponent` | hashtag timeline |
| `favourites`, `bookmarks` | `MastodonTimelineComponent` | Link-header paginated |
| `lists/:id` | `MastodonTimelineComponent` | list timeline |
| `status/:id` | `StatusDetailComponent` | single status + ancestor/descendant context |
| `account/:acct` | `AccountProfileComponent` | profile + that account's statuses |
| `notifications` | `NotificationsColumnComponent` | |
| `search` | `SearchComponent` | accounts / statuses / hashtags |
| `explore` | `ExploreComponent` | trending statuses / tags / links |
| `direct` | `ConversationsColumnComponent` | DM conversations |
| `lists` | `ListsIndexComponent` | the caller's lists |

The single `MastodonTimelineComponent` shell is reused across home / local /
public / hashtag / list / favourites / bookmarks via the route's `data.source`
(and the `:tag` / `:id` params). Supporting components: `TootCardComponent`
(status card — reply/boost/favourite/bookmark, CW expand, media, embedded
`PollComponent`), `ComposeBoxComponent` (composer / inline reply), and the two
role/preference surfaces below (`RoleActionsMenuComponent`,
`AppearancePanelComponent`).

Remote/federated HTML (toot content via `safeContent()`, profile bio + fields via
`safe()`) is rendered through Angular's `[innerHTML]` binding **with the built-in
sanitizer left on** — these helpers return the raw string and never call
`bypassSecurityTrustHtml`, so injected `<script>` / `on*` handlers / `javascript:`
URLs are stripped while safe formatting markup is kept (stored/DOM XSS, A03 /
CWE-79). ✅ shipped.

`MastodonService` (`src/app/mastodon.service.ts`) is a thin, typed wrapper over
the Mastodon REST API (timelines, statuses + context, post/favourite/reblog/
bookmark, polls, media, notifications, accounts + relationships, search,
favourites/bookmarks, lists, conversations, trends). The Mastodon instance base
URL is the runtime global `__SNAP_MASTODON_URL__` (default
`https://mastodon.snapdragon.systems`), reached via the be-gateway.

## Auth, session & role-gate

Login/registration are delegated entirely to **Casdoor** (`id.snapdragon.systems`)
through the **login** remote, which brokers a per-service Mastodon token and
writes it into the shared `snap.session` (localStorage). This remote never
renders a login form:

- `MastodonService` reads its own token from `snap.session.mastodon.token` (a
  host may still call `setAccessToken()` to override); the host injects nothing.
- BFF calls (see below) authenticate with the shared-session `bffToken` Bearer,
  **not** the per-service Mastodon token.

> 🔭 **Roadmap (platform security backlog):** the session + `bffToken` currently
> live in `localStorage` (the `snap.session` key), which is the cross-UI baseline
> today, not the intended end state. Moving bearer/session tokens off
> `localStorage` is tracked platform-wide in the Snapdragon UI standard and will
> land here when that work does.

`SessionService` (`src/app/session.service.ts`) is the canonical Snapdragon
session store. It holds the `SnapSession` and derives the Casdoor role tiers as
signals — `isUser` (any authed user), `isMod` (`mod` **or** `admin`), `isAdmin`
(`admin` only) — plus `fullyRegistered`. Each remote and the host hold their own
`SessionService` over the same `snap.session` key and re-read on a same-document
broadcast / cross-tab `storage` event, so completing registration in the login
remote unlocks the host shell's social nav.

These role signals are **defence-in-depth**: the bff-apis enforce
`ROLE_USER`/`MOD`/`ADMIN` server-side, and the UI simply never shows an option
the role can't use. The additive tiers preserve the invariant that a MOD never
sees the ADMIN tier and a USER never sees the MOD/ADMIN tier.

### Role-tiered action surface

`RoleActionsMenuComponent` (`snap-mastodon-role-actions`, mounted from
`TootCardComponent` and `AccountProfileComponent`) is one reusable menu that
renders three additive tiers off the session role signals:

- **USER** (`isUser`): self-block a Mastodon/internal account
  (`POST/DELETE /bff/user/blocks`) and recommend an instance block to mods
  (`POST /bff/user/recommend-instance-block`) — via `UserBffService`.
- **MOD** (`isMod`): server-wide block of a user/instance
  (`POST /bff/mod/block`) and triage of the moderation queue
  (`GET /bff/mod/moderation`) with refer-to-admin
  (`POST /bff/mod/moderation/{id}/refer`) — via `ModBffService`.
- **ADMIN** (`isAdmin`): approve/deny a moderation request is **rendered but
  STUBBED** — `admin-bff-api` exposes no matching endpoint, so it makes no
  network call and discloses the stub honestly; the full Mastodon admin console
  lives in `snapdragon-admin-ui` by design.

### SOCIAL local-only / domain-lock ✅ shipped

When an admin/mod domain-locks an account, the homeserver's **force-local MRF is
the actual enforcer** — the UI is honest defence-in-depth on top of it, never the
source of truth.

`SessionService.mastodonDomainLocked` is a computed signal off a
`MASTODON_DOMAINLOCKED` role marker that `admin-bff-api` forwards (domainlock
pass-through). The marker is normalised before it is read: a
`ROLE_MASTODON_DOMAINLOCKED` / mixed-case variant is lowercased to
`mastodon_domainlocked` (the same reserved-prefix-aware folding the rest of the
session roles use), so the lock survives prefix/case differences across BFFs.

In `ComposeBoxComponent`, a domain-locked user (`domainLocked()` true):

- has the **federated-reach visibilities** (`public`, `unlisted`) disabled +
  helptext'd in the visibility picker, with the local-only indicator shown as
  enforced (`aria-disabled` so it stays focusable, not natively `disabled`);
- has the bound visibility **coerced down to `private`** in `ngDoCheck` if it is
  ever a federated value (e.g. a `defaultVisibility` Input, or a cross-tab lock
  that lands after the composer opened), and **again at `submit()`** as a second
  defence-in-depth layer even if the bound value was somehow set past the
  disabled UI.

The non-locked case is left honest too: a per-post local-only toggle is *not*
wired (no per-post local-only flag on the homeserver yet), so the control shows
"not available yet" copy rather than pretending to work.

## BFFs & multi-tenancy

The remote talks to two same-origin BFFs that the fe-gateway proxies (base
overridable via `__SNAP_BFF_URL__`, default same origin):

- `UserBffService` → `/bff/user/**` (snapdragon-user-bff-api): self-blocks +
  instance-block recommendation. The user-bff-api forces `owner = JWT subject`,
  so a user only ever sees/edits their own rows.
- `ModBffService` → `/bff/mod/**` (snapdragon-mod-bff-api): the moderation queue
  + server-wide block, gated server-side by `hasAnyRole('MOD','ADMIN')`.

Both follow the Snapdragon datastore pattern (RxJS `BehaviorSubject`-backed,
single source of truth) and attach the shared-session `bffToken` Bearer. Because
the gateway resolves the BFF target per request and the BFFs key every row to the
authenticated JWT subject (issuer-keyed domain scoping), the same federated bundle
serves every brand/tenant — the remote carries no per-tenant config.

### AI-cloak media (poison-before-ingest)

When the composer uploads an **image** with the per-user AI-cloak preference ON,
it routes the file through the BFF media proxy
(`POST /bff/user/media/upload`, authed with the `bffToken`) so the bytes are
Glaze/Nightshade-style perturbed **before** the homeserver ingests / re-encodes /
federates them — a direct `/api/v2/media` upload would let the clean original
federate first. The BFF returns the homeserver `MediaAttachment` exactly as a
direct upload would (downstream `submit()` / `media_ids` is untouched) plus a
server-owned `cloak` decision.

The composer queries `GET /bff/user/media/capability` on open to render an honest
shield state up front, polls `GET /bff/user/media/status/{ref}` so the
per-attachment badge flips `pending → protected/degraded`, and offers a "post now
without protection" escape hatch. The copy is deliberately honest: it never
claims "protected" for a `degraded`/`skipped`/`unavailable`/`failed` outcome, and
warns-before-post when the heavy worker tier is absent (e.g. Pi5-only cluster).

## Appearance / style preferences

Every signed-in user (user / mod / admin) can customise **their own** look from
the timeline-header gear (`AppearancePanelComponent`, modelled on the spirit of
TangerineUI for Mastodon — no CSS copied): colour theme + accent,
light/dark/auto, single vs multi column, density, media corners, font family
(incl. a dyslexia-friendly option), text size, plus high-contrast and
reduced-motion toggles.

`PreferencesService` is the single source of truth: each change flows through one
`persist()` chokepoint, is saved to a versioned localStorage key
(`snap.mastodon.prefs.v1`), and is applied as `data-*` attributes + CSS custom
properties **scoped to this remote's own root** (`.snap-mastodon` /
`snap-mastodon-root`) so it never leaks onto the host or sibling remotes. OS
`prefers-reduced-motion` / `prefers-contrast` are honoured on first load. An
ADMIN-only "set as the default for everyone" control writes the org default that
non-customised users inherit — honestly local/asset-backed for now
(`assets/mastodon-appearance-default.json` + a per-browser override), with the
durable `/bff/user/preferences` and admin-bff org-default hooks documented in the
service.

## Accessibility conventions

The remote follows the cross-repo Snapdragon a11y standard (baseline copied into
`src/styles.scss`), so it is accessible standalone and consistent when federated:

- The `.sr` screen-reader-only helper carries text labels alongside icon-only
  controls; decorative emoji/icons are `aria-hidden="true"`.
- Async results announce through live regions — `role="status"`/`aria-live`
  (`polite`) for normal updates, `role="alert"`/`assertive` for errors; the
  appearance panel and role-actions menu announce each applied change.
- Toggle controls expose state via `aria-pressed` / `aria-expanded`; pop-over
  panels trap focus on open, restore it to the trigger on close, and close on
  `Escape`.
- Composer fields use unique `<label for>` bindings (per-instance id prefixes so
  inline reply composers stay unique) and a live character counter.
- WCAG-AA/AAA `--sd-*` colour tokens, a touch-target minimum, and a
  reduced-motion media query are baked into the baseline styles.
- Full **keyboard operability** ✅ shipped: native buttons/inputs/selects
  throughout; the account-profile tabs are a WAI-ARIA `tablist` with a roving
  `tabindex` driven by `ArrowLeft` / `ArrowRight` / `Home` / `End`
  (`onTabKeydown`); the compose "Attach media" file input is visually hidden but
  kept **in the tab order** (`.sr`, not `hidden`) so it stays focusable; and the
  dev shell provides a skip link to a focusable `<main>` landmark, backed by a
  global `:focus-visible` ring.

## Develop

```bash
npm install
npm start                 # ng serve mastodon — the dev shell on :4202
npm run build             # build the remote → dist/mastodon/browser
npm run build:mastodon    # same (explicit alias)
npm test                  # ng test mastodon (ChromeHeadlessCI, single run)
```

The application builder nests output under `dist/mastodon/browser/`, including
`remoteEntry.json` (the federation manifest that exposes `./routes`). Angular CLI
22 requires Node >= 24.15.

## Deploy

`Dockerfile` builds the remote and serves `dist/mastodon/browser` via nginx
**with CORS** (the host fetches `remoteEntry.json` cross-origin); `/healthz`
returns `200`. `.gitlab-ci.yml` builds + pushes the image to the in-cluster
GitLab registry (the GitHub repo is pull-mirrored into in-cluster GitLab). The
image is deployed to the `snapdragon-frontend` namespace and fronted by the
fe-gateway at `/social/mastodon`.

### OWASP pen-test stage ✅ shipped

`.gitlab-ci.yml` declares two stages — `build` and `pentest` — and `include`s the
centralized OWASP pen-test templates from the generator
(`Snapdragon-Systems/snapdragon-generator @ main`,
`/tests/pentest/ci/pentest-stage.gitlab-ci.yml`), so this repo rides the one
source of truth rather than carrying its own scanner config:

- `pentest:sca` extends `.pentest-sca` — Dependency-Check SCA over this repo's
  checkout.
- `pentest:dast` extends `.pentest-dast-baseline` — an authenticated ZAP baseline
  (spider + passive + probes + nuclei) via the shared harness against a spun-up
  env-test-build.

Both run on merge requests and the default branch and are `allow_failure: true`,
so a finding reports without breaking the image build. `make pentest`
(`pentest-sca` + `pentest-dast`) runs the same self-scan locally, mirroring the CI
stage (SCA via `npm audit` locally / Dependency-Check in CI; DAST via the shared
harness when `DAST_TARGET_URL` is set).
</content>
</invoke>
