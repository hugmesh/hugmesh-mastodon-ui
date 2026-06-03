# snapdragon-mastodon-ui

The **Mastodon** Angular micro-frontend (native-federation **remote**) for the
[snapdragon.systems](https://github.com/Snapdragon-Systems/snapdragon.systems)
host. Federated into the host and served at `/social/mastodon` by the
`snapdragon-fe-gateway` (Spring Cloud Gateway) on the frontend Pi nodes.

Part of the Snapdragon RPi 5 / x86_64 cluster built by
[catalyst-scripts](https://github.com/Snapdragon-Systems/catalyst-scripts).
The sibling remotes live in their own repos:
[matrix](https://github.com/Snapdragon-Systems/snapdragon-social-ui) ·
[login](https://github.com/Snapdragon-Systems/snapdragon-login-ui) ·
[admin](https://github.com/Snapdragon-Systems/snapdragon-admin-ui).

## What's here

An Angular 18 + `@angular-architects/native-federation` single-project workspace
(`mastodon`, root `.`, sourceRoot `src`, prefix `snap-mastodon`). It exposes
`./routes` → **`MASTODON_ROUTES`**, which the host loads at runtime via
`loadRemoteModule('mastodon', './routes')` and mounts at `/social/mastodon`.

The remote ships `MastodonService` and `MastodonTimelineComponent`
(home/public timelines + composer). `src/app/app.component.ts` is a small
standalone dev shell (`snap-mastodon-root`) used only when the remote runs on
its own; in production the host federates `./routes` directly and the shell is
not loaded.

## Auth & token model (no external login UI)

Login/registration are delegated entirely to **Casdoor** (`id.snapdragon.systems`)
through the **login** remote, which brokers per-service tokens via the admin BFF
and writes them into the shared `snap.session` (localStorage). Each remote reads
its own token from that session — the host injects nothing. `MastodonService`
reads `snap.session.mastodon.token` (a host may still `setAccessToken()` to
override), so the remote never renders a login form.

Backend URL is a runtime global: `__SNAP_MASTODON_URL__`
(default `https://mastodon.snapdragon.systems`).

## Develop

```bash
npm install
npm start                 # ng serve mastodon — the dev shell on :4202
npm run build             # build the remote → dist/mastodon/browser
npm run build:mastodon    # same (explicit alias)
```

The application builder nests output under `dist/mastodon/browser/`, including
`remoteEntry.json` (the federation manifest that exposes `./routes`).

## Deploy

`Dockerfile` builds the Mastodon remote and serves `dist/mastodon/browser` via
nginx **with CORS** (the host fetches `remoteEntry.json` cross-origin); a
`/healthz` endpoint returns `200`. The image is deployed to the
`snapdragon-frontend` namespace and fronted by the fe-gateway at
`/social/mastodon`.
