/**
 * Where this remote's own shipped `assets/` tree lives, as an ABSOLUTE URL.
 *
 * THE TRAP: a bare relative string like `'assets/vn/scenes/'` is resolved by
 * `fetch()` (and by `new Image().src` / an `<img src>` binding) against the
 * DOCUMENT's URL — NOT against the Angular app's base href, and NOT against this
 * remote's mount. Standalone that is harmless, because the document already sits
 * inside the remote. Federated into the host shell the document is the SHELL, at
 * `/social/mastodon` with no trailing slash, so `assets/vn/scenes/scenes.json`
 * resolves to `/assets/vn/scenes/scenes.json` at the SHELL ROOT and 404s.
 * Verified live on the operator mesh 2026-08-14 — both
 * `https://localhost:8488/assets/vn/scenes/scenes.json` and
 * `https://localhost:8488/assets/mastodon-appearance-default.json` return 404,
 * while both files are present in this remote's own container under
 * `/usr/share/nginx/html/assets/`.
 *
 * `import.meta.url` is the URL of the very chunk this module is bundled into,
 * which is served from the remote's own mount in BOTH cases
 * (`/social/mastodon/…` federated, `/` standalone) — so anchoring on it needs no
 * hardcoded mount path and no build-time base href. `document.baseURI` is the
 * fallback for a non-ESM or test context.
 *
 * This is the same fix, and deliberately the same shape, as the canonical
 * `resolveAssetsBase()` in hugmesh-character-studio-ui
 * (`src/app/character-studio/services/assets-base.ts`). It is the URL-side twin
 * of `mount-route.ts`: one resolves ASSETS against the module, the other
 * resolves ROUTES against the mount, and a federated remote needs both.
 */

/**
 * The anchor asset paths resolve against: this module's own chunk URL, with the
 * document as a non-ESM/test fallback. Exported for tests — production code
 * should call {@link resolveAssetsBase}.
 */
export function assetsAnchor(): string {
  return typeof import.meta?.url === 'string'
    ? import.meta.url
    : typeof document !== 'undefined'
      ? document.baseURI
      : '/';
}

/**
 * Resolve `relative` against an explicit `anchor`. Pure, so a test can prove the
 * shell-mounted case without a shell.
 */
export function assetsBaseFrom(anchor: string, relative: string): string {
  try {
    // Chunks are emitted beside index.html, so the module's directory IS the
    // app root; new URL() normalises it into an absolute href.
    return new URL(relative, anchor).href;
  } catch {
    return relative;
  }
}

/**
 * The absolute URL of `relative` (e.g. `'assets/vn/scenes/'`) inside THIS
 * remote, whichever mount it is served from.
 */
export function resolveAssetsBase(relative: string): string {
  return assetsBaseFrom(assetsAnchor(), relative);
}
