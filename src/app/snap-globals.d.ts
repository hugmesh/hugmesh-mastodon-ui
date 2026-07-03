/** Ambient runtime-override globals shared by mastodon.service.ts, mod-bff.service.ts,
 *  and user-bff.service.ts. The host shell may set these on `globalThis` before this
 *  remote bootstraps to override the default Mastodon/BFF base URLs at runtime. */
declare global {
  // eslint-disable-next-line no-var
  var __SNAP_MASTODON_URL__: string | undefined;
  // eslint-disable-next-line no-var
  var __SNAP_BFF_URL__: string | undefined;
}

export {};
