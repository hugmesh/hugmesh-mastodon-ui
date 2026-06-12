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
</content>
</invoke>
