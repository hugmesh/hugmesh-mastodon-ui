import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { resolveAssetsBase } from './assets-base';

/** Same-origin base; the fe-gateway proxies /bff/user/** and /bff/mastodon/** +
 *  /bff/admin/mastodon/** to hugmesh-user-bff-api / hugmesh-admin-bff-api.
 *  Mirrors UserBffService/AdminBffService's __HUG_BFF_URL__ runtime override hook. */
const BFF = (globalThis as any).__HUG_BFF_URL__ ?? '';

/* ──────────────────────────────────────────────────────────────────────────
 * Per-user STYLE + VIEW preferences for the hugmesh-mastodon-ui remote.
 *
 * Modelled on the spirit of nileane/TangerineUI-for-Mastodon (a popular SCSS
 * theme): every signed-in user (user / mod / admin) customises their OWN look —
 * colour theme + accent, light/dark/auto, single vs multi column, density,
 * media corners, font family (incl. a dyslexia-friendly option), text size,
 * high-contrast and reduced-motion. ADMINS additionally define the DEFAULT
 * preference set that users who have NOT customised inherit.
 *
 * We do NOT copy TangerineUI's CSS; instead each option maps to a CSS custom
 * property and/or a body-style class that this remote's brand SCSS
 * (preferences.partial in styles.scss) keys off. Everything is APPLIED to this
 * remote's own root element(s) — the `.hug-mastodon` subtree(s) — so it never
 * leaks onto the federation host or sibling remotes (matrix/login/admin).
 * ────────────────────────────────────────────────────────────────────────── */

/** Bump when the stored shape changes incompatibly. Old keys are ignored and
 *  the user falls back to the admin/org default (then built-in default). */
export const PREFS_STORAGE_KEY = 'hug.mastodon.prefs.v1';

/** The shipped, baked-in-at-deploy-time org default asset — the fallback used
 *  ONLY when the brand has no admin-bff-configured default yet (or the network
 *  call fails). The durable, cluster-wide org default now lives in
 *  admin-bff-api and is read via {@link DEFAULTS_SYNC_HOOK}; this asset is the
 *  offline/unconfigured baseline underneath it.
 *
 *  MODULE-ANCHORED, not document-relative: see {@link resolveAssetsBase}. As a
 *  bare `'assets/…'` string this fetched from the SHELL root under federation
 *  and 404'd, silently dropping every deployment's org default. */
export const ORG_DEFAULT_ASSET = resolveAssetsBase('assets/mastodon-appearance-default.json');

export type ColorTheme = 'hug-neon' | 'pastel-rose' | 'pastel-sky' | 'pastel-mint' | 'mono';
export type Accent = 'neon' | 'rose' | 'lavender' | 'sky' | 'mint' | 'peach';
export type Appearance = 'auto' | 'light' | 'dark';
export type Layout = 'single' | 'multi';
export type Density = 'comfortable' | 'compact';
export type MediaCorners = 'rounded' | 'square';
export type FontFamily = 'system' | 'serif' | 'mono' | 'dyslexic';
export type TextSize = 'sm' | 'md' | 'lg' | 'xl';

/* ── CHAT THEME group (personal-only; never part of the admin/org default) ──
 * Styles the direct-message / chat surfaces (.chat-bubble mine/theirs, the
 * chat surface background) and the visual-novel dialogue box (.vn-dialog —
 * the ONLY coordination contract with hug-mastodon-vn-chat, alongside the
 * --mastodon-chat-* CSS vars). */
export type ChatBubbleShape = 'rounded' | 'square' | 'sharp';
export type ChatFont = 'system' | 'serif' | 'rounded' | 'mono';
export type ChatDensity = 'cozy' | 'compact';
export type ChatBackground = 'none' | 'dots' | 'lined' | 'stars';
export type VnDialogSkin = 'classic' | 'glass' | 'retro';

export interface AppearancePreferences {
  theme: ColorTheme;
  accent: Accent;
  appearance: Appearance;
  layout: Layout;
  density: Density;
  mediaCorners: MediaCorners;
  font: FontFamily;
  textSize: TextSize;
  highContrast: boolean;
  reducedMotion: boolean;
  // ── chat theme (personal-only) ──
  chatBubbleShape: ChatBubbleShape;
  /** #rrggbb accent for the caller's OWN bubbles; '' = unset (today's look). */
  chatAccentMine: string;
  /** #rrggbb accent for the other side's bubbles; '' = unset (today's look). */
  chatAccentTheirs: string;
  chatFont: ChatFont;
  chatDensity: ChatDensity;
  chatBackground: ChatBackground;
  vnDialogSkin: VnDialogSkin;
  /** VN chat mode: the chosen scene-background id from the shipped
   *  assets/vn/scenes manifest (SceneService). Durable key
   *  `mastodon.appearance.chat.vnScene` — see {@link DURABLE_KEY_SUFFIX}. */
  chatVnScene: string;
  /** VN chat mode: comma-joined enabled on-stage prop ids ('' = none). Kept a
   *  plain string so the value slots into the string-per-key BFF preference
   *  store like every other field. Durable key
   *  `mastodon.appearance.chat.vnProps`. */
  chatVnProps: string;
}

/** Strict #rrggbb (6 hex digits, leading #) — the ONLY accepted chat accent
 *  shape. Validated before an accent is saved, synced or written as a CSS var
 *  so a malformed/hostile string (from storage or the wire) can never reach
 *  style.setProperty. '' is the distinct "unset" state, not a colour. */
export const CHAT_ACCENT_HEX_RE = /^#[0-9a-fA-F]{6}$/;
export function isValidChatAccent(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || CHAT_ACCENT_HEX_RE.test(value));
}

/** LENGTH CAPS for the two free-form chat VN string prefs — the only string
 *  fields whose value is not a closed enum. Enforced at BOTH write boundaries
 *  ({@link PreferencesService.set} and the BFF hydrate) so a corrupt/hostile
 *  stored value can never balloon the DOM data-attribute / localStorage blob.
 *  Generous: a shipped manifest id is ~20 chars (cap 128); 16 enabled props ×
 *  64-char ids + commas fits well inside 2048. */
export const CHAT_VN_FIELD_MAX: Partial<Record<keyof AppearancePreferences, number>> = {
  chatVnScene: 128,
  chatVnProps: 2048,
};
export function isValidChatVnString(field: keyof AppearancePreferences, value: unknown): boolean {
  const max = CHAT_VN_FIELD_MAX[field];
  if (max === undefined) return true; // not a capped field
  return typeof value === 'string' && value.length <= max;
}

/** The chat-theme fields as a group (reset / personal-only stripping). */
export const CHAT_FIELDS: readonly (keyof AppearancePreferences)[] = [
  'chatBubbleShape', 'chatAccentMine', 'chatAccentTheirs',
  'chatFont', 'chatDensity', 'chatBackground', 'vnDialogSkin',
  'chatVnScene', 'chatVnProps',
];

/** The two hex-valued chat fields: applied as inline --mastodon-chat-accent-*
 *  CSS vars (validated), NOT as data attributes. */
const CHAT_ACCENT_FIELDS: ReadonlySet<keyof AppearancePreferences> = new Set(['chatAccentMine', 'chatAccentTheirs']);

/** A one-field change emitted to listeners (the panel announces it in a live
 *  region). */
export type PrefChange = { key: keyof AppearancePreferences; value: AppearancePreferences[keyof AppearancePreferences] };

/** Each preference maps to a `data-*` attribute on the remote root; the SCSS
 *  selectors key off these. textSize/highContrast/reducedMotion ALSO drive CSS
 *  custom properties so they cascade into every nested component. The two hex
 *  chat accents are EXCLUDED: free-form colour values are applied only as
 *  validated --mastodon-chat-accent-* CSS vars (see {@link apply}), never as
 *  attribute values. */
const DATA_ATTR: Record<Exclude<keyof AppearancePreferences, 'chatAccentMine' | 'chatAccentTheirs'>, string> = {
  theme: 'data-mastodon-theme',
  accent: 'data-mastodon-accent',
  appearance: 'data-mastodon-appearance',
  layout: 'data-mastodon-layout',
  density: 'data-mastodon-density',
  mediaCorners: 'data-mastodon-corners',
  font: 'data-mastodon-font',
  textSize: 'data-mastodon-textsize',
  highContrast: 'data-mastodon-contrast',
  reducedMotion: 'data-mastodon-motion',
  chatBubbleShape: 'data-mastodon-chat-shape',
  chatFont: 'data-mastodon-chat-font',
  chatDensity: 'data-mastodon-chat-density',
  chatBackground: 'data-mastodon-chat-bg',
  vnDialogSkin: 'data-mastodon-chat-vnskin',
  chatVnScene: 'data-mastodon-chat-vnscene',
  chatVnProps: 'data-mastodon-chat-vnprops',
};

/** The remote roots we scope styling to. The timeline column carries the
 *  `.hug-mastodon` class; the standalone dev shell uses `hug-mastodon-root`.
 *  Applying to BOTH (when present) keeps the styling on this remote's subtree
 *  whether it runs standalone or federated into the host. */
const REMOTE_ROOT_SELECTOR = '.hug-mastodon, hug-mastodon-root';

/* ──────────────────────────────────────────────────────────────────────────
 * BFF SYNC — WIRED. Backed by hugmesh-user-bff-api's durable
 * UserPreferencesService (owner = JWT subject; a `mastodon.appearance.<field>`
 * key per AppearancePreferences field, each value-validated server-side):
 *   - on load: GET /bff/user/preferences → any mastodon.appearance.* keys
 *     present hydrate() over localStorage (server value wins so prefs follow
 *     the user across devices); offline/404/error silently keeps the
 *     localStorage-resolved state (never blocks first paint).
 *   - on change: PUT /bff/user/preferences { key, value } per field (fires
 *     from the single {@link set} chokepoint). A failed write is NEVER a
 *     silent no-op — it applies locally immediately (so the UI stays
 *     responsive) but surfaces on {@link syncError} so the panel can tell the
 *     user the change may not follow them to another device.
 * ────────────────────────────────────────────────────────────────────────── */
export const BFF_SYNC_HOOK = 'PUT/GET /bff/user/preferences { key, value } — see UserBffService';
const USER_PREFS_PATH = '/bff/user/preferences';
/** The durable key prefix a field maps to in the user-bff-api preference store —
 *  MUST mirror UserPreferencesService.APPEARANCE_* in hugmesh-user-bff-api. */
const APPEARANCE_KEY_PREFIX = 'mastodon.appearance.';
const APPEARANCE_FIELDS: (keyof AppearancePreferences)[] = [
  'theme', 'accent', 'appearance', 'layout', 'density',
  'mediaCorners', 'font', 'textSize', 'highContrast', 'reducedMotion',
  ...CHAT_FIELDS,
];
const BOOLEAN_FIELDS: ReadonlySet<keyof AppearancePreferences> = new Set(['highContrast', 'reducedMotion']);

/** Durable-key suffix overrides: the chat group persists under the namespaced
 *  `mastodon.appearance.chat.*` keys (the BFF contract for this group) rather
 *  than the flat `mastodon.appearance.<field>` shape the original fields use. */
const DURABLE_KEY_SUFFIX: Partial<Record<keyof AppearancePreferences, string>> = {
  chatBubbleShape: 'chat.bubbleShape',
  chatAccentMine: 'chat.accentMine',
  chatAccentTheirs: 'chat.accentTheirs',
  chatFont: 'chat.font',
  chatDensity: 'chat.density',
  chatBackground: 'chat.background',
  vnDialogSkin: 'chat.vnDialogSkin',
  chatVnScene: 'chat.vnScene',
  chatVnProps: 'chat.vnProps',
};

/** The /bff/user/preferences key a field round-trips through. */
export function durableKeyFor(field: keyof AppearancePreferences): string {
  return APPEARANCE_KEY_PREFIX + (DURABLE_KEY_SUFFIX[field] ?? field);
}

/* ──────────────────────────────────────────────────────────────────────────
 * DEFAULTS SYNC — WIRED. Backed by hugmesh-admin-bff-api's durable
 * MastodonAppearanceDefaultService (domain-scoped; ADMIN-write-gated):
 *   - on load: GET /bff/mastodon/appearance-default → if the brand has a
 *     configured default AND the caller has not customised, adopt it —
 *     ahead of the shipped {@link ORG_DEFAULT_ASSET} baseline (the asset
 *     stays the offline/no-admin-default-yet fallback).
 *   - setOrgDefault(): PUT /bff/admin/mastodon/appearance-default { prefs }.
 *     Applies + caches locally immediately (so the admin sees it take effect
 *     right away and it survives an offline reload), but a failed durable
 *     write is NEVER a silent no-op — it surfaces on {@link syncError} so the
 *     admin knows the "for everyone" save did not actually reach the backend.
 * ────────────────────────────────────────────────────────────────────────── */
export const DEFAULTS_SYNC_HOOK = 'PUT /bff/admin/mastodon/appearance-default { prefs } — admin-bff';
const ORG_DEFAULT_READ_PATH = '/bff/mastodon/appearance-default';
const ORG_DEFAULT_WRITE_PATH = '/bff/admin/mastodon/appearance-default';
export const ORG_DEFAULT_LOCAL_KEY = 'hug.mastodon.prefs.orgdefault.v1';

/** The shipped built-in default. Mirrors the brand: neon theme, dark, single
 *  column, comfortable, rounded media, system font, medium text. */
export const BUILTIN_DEFAULT: AppearancePreferences = {
  theme: 'hug-neon',
  accent: 'neon',
  appearance: 'dark',
  layout: 'single',
  density: 'comfortable',
  mediaCorners: 'rounded',
  font: 'system',
  textSize: 'md',
  highContrast: false,
  reducedMotion: false,
  // Chat theme defaults — chosen so the SCSS fallbacks render EXACTLY today's
  // look ('' accents = no --mastodon-chat-accent-* var written; the non-default
  // shape/font/density/background values are the only ones with rules).
  chatBubbleShape: 'rounded',
  chatAccentMine: '',
  chatAccentTheirs: '',
  chatFont: 'system',
  chatDensity: 'cozy',
  chatBackground: 'none',
  vnDialogSkin: 'classic',
  // VN chat stage: bedroom backdrop, no props, until the user picks.
  chatVnScene: 'vn_scene_bedroom',
  chatVnProps: '',
};

const TEXT_SIZE_REM: Record<TextSize, string> = {
  sm: '0.9375rem',
  md: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
};

/**
 * Signal + RxJS-BehaviorSubject backed datastore for the caller's appearance
 * preferences. One source of truth: every change flows through {@link set}
 * → {@link persist} → {@link apply}. Components read the {@link prefs} signal;
 * the panel also subscribes to {@link changes$} to announce applied changes.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  /** True once the user has saved at least one explicit choice (so we know not
   *  to silently overwrite their prefs when an admin default changes). */
  private customised = false;

  /** Built from: built-in default ← org/admin default ← the user's own saved
   *  prefs (later overrides earlier). */
  private current: AppearancePreferences = this.resolveInitial();

  readonly prefs = signal<AppearancePreferences>(this.current);

  private readonly prefsSubject = new BehaviorSubject<AppearancePreferences>(this.current);
  /** One source of truth any view can subscribe to (datastore pattern). */
  readonly prefs$: Observable<AppearancePreferences> = this.prefsSubject.asObservable();

  private readonly changeSubject = new BehaviorSubject<PrefChange | null>(null);
  /** The most-recent single-field change (null at boot). Drives the live-region
   *  announcement and the BFF write. */
  readonly changes$: Observable<PrefChange | null> = this.changeSubject.asObservable();

  /** The most recent BFF sync failure (null when the last relevant write/read
   *  succeeded, or none has been attempted yet). A local change ALWAYS applies
   *  immediately regardless of network state — this is the honest, non-blocking
   *  signal that the durable/cross-device or platform-wide save did not actually
   *  reach the backend, so a consumer (the appearance panel) can tell the user
   *  rather than silently pretending success. */
  readonly syncError = signal<string | null>(null);

  constructor() {
    // Honour the OS defaults the FIRST time (before any explicit choice): a user
    // who prefers reduced motion / more contrast gets them on by default.
    if (!this.customised && typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.current.reducedMotion = true;
      if (window.matchMedia('(prefers-contrast: more)').matches) this.current.highContrast = true;
      this.prefs.set({ ...this.current });
      this.prefsSubject.next({ ...this.current });
    }
    // Apply on construction so the remote restyles immediately on load. Re-apply
    // after a tick too, so roots that mount after the service does (the timeline)
    // still get the data-attributes.
    this.apply();
    if (typeof window !== 'undefined') {
      window.addEventListener(PREFS_STORAGE_KEY, () => this.reloadFromStorage());
      window.addEventListener('storage', (e) => {
        if (e.key === PREFS_STORAGE_KEY) this.reloadFromStorage();
      });
    }
    // Best-effort, non-blocking: refine the synchronously-resolved (localStorage)
    // state from the real backends. First the caller's own durable prefs (server
    // wins over the local cache), THEN the org/admin default chain (real admin-bff
    // default, falling back to the shipped asset only when no admin default has
    // been configured yet / the network call fails). Failures are swallowed at
    // every layer — we already resolved to an honest default above.
    void this.syncFromServer();
  }

  /** Orchestrates the async refinement of the synchronously-resolved state from
   *  the real backends, in priority order: the caller's OWN durable prefs first
   *  (so a customised-elsewhere user is recognised before the org-default fetch
   *  checks {@link isCustomised}), then the org/admin default (real backend, with
   *  the shipped asset as the offline/unconfigured fallback). */
  private async syncFromServer(): Promise<void> {
    await this.loadUserBffPrefs();
    const gotOrgBffDefault = await this.loadOrgBffDefault();
    // Skip the shipped-asset fallback when either a fresh admin-bff default was
    // just applied, OR a previously-synced org default is already cached locally
    // (and therefore already reflected in the synchronously-resolved `current` —
    // re-applying the asset here would incorrectly clobber it with the built-in
    // baseline on an offline/failed-fetch reload).
    if (!gotOrgBffDefault && !this.hasLocalOrgDefaultCache()) await this.loadAssetDefault();
  }

  private hasLocalOrgDefaultCache(): boolean {
    try {
      return localStorage.getItem(ORG_DEFAULT_LOCAL_KEY) !== null;
    } catch {
      return false;
    }
  }

  /** GET /bff/user/preferences; hydrate() with any `mastodon.appearance.*` keys
   *  present (server value wins over the localStorage cache — prefs follow the
   *  user across devices). Best-effort: offline/401/404/error leaves the
   *  already-resolved (localStorage) state untouched, never blocks first paint. */
  private async loadUserBffPrefs(): Promise<void> {
    if (typeof fetch !== 'function') return;
    try {
      const res = await fetch(`${BFF}${USER_PREFS_PATH}`, { credentials: 'include', cache: 'no-cache' });
      if (!res.ok) return;
      const raw = (await res.json()) as Record<string, string>;
      const partial: Partial<AppearancePreferences> = {};
      let any = false;
      for (const field of APPEARANCE_FIELDS) {
        const rawValue = raw[durableKeyFor(field)];
        if (rawValue === undefined) continue;
        // Fail-soft on a malformed/hostile server-delivered accent: only strict
        // #rrggbb (or '' = unset) may ever reach a CSS-var write.
        if (CHAT_ACCENT_FIELDS.has(field) && !isValidChatAccent(rawValue)) continue;
        // Fail-soft on an over-long server-delivered VN scene/props string
        // (see CHAT_VN_FIELD_MAX) — keep the already-resolved local value.
        if (!isValidChatVnString(field, rawValue)) continue;
        any = true;
        (partial as Record<string, unknown>)[field] = BOOLEAN_FIELDS.has(field)
          ? rawValue === 'true'
          : rawValue;
      }
      if (any) this.hydrate(partial, /* markCustomised */ true);
    } catch {
      /* ignore — offline/dev; the localStorage-resolved state already applied */
    }
  }

  /** GET /bff/mastodon/appearance-default; if the brand has a configured
   *  default AND the caller has not customised, adopt it (ahead of the shipped
   *  asset) and cache it locally so an offline reload still reflects it. Returns
   *  {@code true} iff a default was applied (so the caller can skip the asset
   *  fallback). Best-effort: offline/error/no-default-yet returns false. */
  private async loadOrgBffDefault(): Promise<boolean> {
    if (typeof fetch !== 'function' || this.customised) return false;
    try {
      const res = await fetch(`${BFF}${ORG_DEFAULT_READ_PATH}`, { credentials: 'include', cache: 'no-cache' });
      if (!res.ok) return false;
      const raw = (await res.json()) as Partial<AppearancePreferences>;
      if (Object.keys(raw).length === 0) return false; // no admin default configured for this brand yet
      if (this.customised) return false; // re-check: a concurrent user prefs sync may have landed first
      this.current = { ...this.current, ...raw };
      this.commit(/* persistUser */ false);
      try {
        localStorage.setItem(ORG_DEFAULT_LOCAL_KEY, JSON.stringify(this.current));
      } catch {
        /* ignore quota / private-mode */
      }
      return true;
    } catch {
      return false; // offline/dev — fall back to the shipped asset
    }
  }

  /** Fetch the shipped {@link ORG_DEFAULT_ASSET}; if present AND the user has
   *  not customised, adopt it as the default. Only reached when no real
   *  admin-bff default is configured for this brand (or the fetch failed) —
   *  see {@link loadOrgBffDefault}. Best-effort and non-blocking. */
  private async loadAssetDefault(): Promise<void> {
    if (typeof fetch !== 'function' || this.customised) return;
    try {
      const res = await fetch(ORG_DEFAULT_ASSET, { cache: 'no-cache' });
      if (!res.ok) return;
      const raw = (await res.json()) as Partial<AppearancePreferences>;
      // Strip the documentation-only _comment key if present.
      delete (raw as Record<string, unknown>)['_comment'];
      if (!this.customised) {
        this.current = { ...BUILTIN_DEFAULT, ...raw };
        this.commit(/* persistUser */ false);
      }
    } catch {
      /* ignore — built-in default already applied */
    }
  }

  /** Current values (immutable copy). */
  snapshot(): AppearancePreferences {
    return { ...this.current };
  }

  /** Has the user saved at least one explicit choice (vs. inheriting a default)? */
  isCustomised(): boolean {
    return this.customised;
  }

  /** Set ONE preference, persist it, and apply it to the remote root(s). Applies
   *  locally + announces IMMEDIATELY (never blocked on the network); the durable
   *  cross-device save is pushed best-effort in the background and a failure
   *  surfaces on {@link syncError} — see {@link pushUserPref}. */
  set<K extends keyof AppearancePreferences>(key: K, value: AppearancePreferences[K]): void {
    if (this.current[key] === value) return;
    // Chat accents are the only free-form values: reject anything that is not
    // strict #rrggbb (or '' = unset) BEFORE it can be applied, persisted or
    // synced — the CSS-var write in apply() only ever sees validated colours.
    if (CHAT_ACCENT_FIELDS.has(key) && !isValidChatAccent(value)) return;
    // VN scene/props are free-form strings too: refuse an over-long value at
    // this single write chokepoint (see CHAT_VN_FIELD_MAX).
    if (!isValidChatVnString(key, value)) return;
    this.current = { ...this.current, [key]: value };
    this.customised = true;
    this.commit();
    this.changeSubject.next({ key, value });
    this.pushUserPref(key, value);
  }

  /** Replace the WHOLE set (used when hydrating from a saved/BFF/default blob). */
  hydrate(next: Partial<AppearancePreferences>, markCustomised = true): void {
    this.current = { ...this.current, ...next };
    if (markCustomised) this.customised = true;
    this.commit();
  }

  /** Discard the user's overrides and fall back to the org/admin (then built-in)
   *  default. Clears the per-user key but leaves the org default intact. */
  resetToDefault(): void {
    try {
      localStorage.removeItem(PREFS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.customised = false;
    this.current = this.resolveDefault();
    this.commit(/* persistUser */ false);
  }

  /** Reset ONLY the chat-theme group to the built-in defaults, leaving every
   *  other appearance choice untouched. Routed through {@link set} per field so
   *  the reset persists + syncs exactly like any other change (and no-op fields
   *  are skipped). */
  resetChatToDefault(): void {
    for (const field of CHAT_FIELDS) this.set(field, BUILTIN_DEFAULT[field]);
  }

  // ── ADMIN: org/default layout ──────────────────────────────────────────
  /** The org/admin default currently in effect (what a non-customised user
   *  inherits). */
  orgDefault(): AppearancePreferences {
    return this.loadOrgDefault();
  }

  /**
   * ADMIN-only: write the given set as the ORG DEFAULT and apply it. Applies +
   * caches locally IMMEDIATELY (per-browser via ORG_DEFAULT_LOCAL_KEY, so the
   * admin sees it take effect right away and it survives an offline reload);
   * the durable, cluster-wide write is pushed best-effort to
   * {@link DEFAULTS_SYNC_HOOK} in the background — a failure NEVER silently
   * "succeeds": it surfaces on {@link syncError} so the admin knows the "for
   * everyone" save did not actually reach the backend. Callers MUST gate this
   * on SessionService.isAdmin(); the service does not know the caller's role
   * (UI gating is defence-in-depth, admin-bff's hasRole('ADMIN') enforces it
   * server-side — a non-admin's PUT is rejected regardless of this gating).
   *
   * If the current user has NOT customised, the new default takes effect for
   * them immediately too.
   */
  setOrgDefault(next: AppearancePreferences): void {
    // The chat-theme group is PERSONAL-ONLY: an admin's own chat styling never
    // becomes the org default. Strip it back to the built-ins at this single
    // write chokepoint so neither the local cache nor the durable admin-bff
    // default ever carries a chat customisation.
    const sanitised: AppearancePreferences = { ...next };
    for (const field of CHAT_FIELDS) {
      (sanitised as unknown as Record<string, unknown>)[field] = BUILTIN_DEFAULT[field];
    }
    try {
      localStorage.setItem(ORG_DEFAULT_LOCAL_KEY, JSON.stringify(sanitised));
    } catch {
      /* ignore quota / private-mode */
    }
    if (!this.customised) {
      this.current = { ...sanitised };
      this.commit(/* persistUser */ false);
    }
    this.pushOrgDefault(sanitised);
  }

  // ── internals ──────────────────────────────────────────────────────────
  /** Persist (optionally) + push to signal/subject + re-style the remote. */
  private commit(persistUser = true): void {
    if (persistUser) this.persist();
    this.prefs.set({ ...this.current });
    this.prefsSubject.next({ ...this.current });
    this.apply();
  }

  /** The single localStorage write chokepoint. The durable cross-device BFF
   *  write is a SEPARATE push (see {@link pushUserPref}) fired from {@link set}
   *  — kept apart from this chokepoint so a local-only mutation (e.g.
   *  {@link hydrate}ing FROM the server) never re-PUTs what it just read. */
  private persist(): void {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      /* ignore quota / private-mode */
    }
  }

  /** PUT /bff/user/preferences { key, value } for one changed field — see
   *  {@link BFF_SYNC_HOOK}. Best-effort/non-blocking: the local apply already
   *  happened in {@link set}; success clears {@link syncError}, failure sets an
   *  honest message (the change is NOT silently treated as durably saved). */
  private pushUserPref<K extends keyof AppearancePreferences>(key: K, value: AppearancePreferences[K]): void {
    if (typeof fetch !== 'function') return;
    const body = JSON.stringify({
      key: durableKeyFor(key),
      value: BOOLEAN_FIELDS.has(key) ? String(value) : value,
    });
    fetch(`${BFF}${USER_PREFS_PATH}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`preferences save failed (${res.status})`);
        this.syncError.set(null);
      })
      .catch(() => {
        this.syncError.set(
          `Could not save "${String(key)}" to your account — it applied here but may not follow you to another device.`,
        );
      });
  }

  /** PUT /bff/admin/mastodon/appearance-default { prefs } — see
   *  {@link DEFAULTS_SYNC_HOOK}. Best-effort/non-blocking: the local
   *  apply+cache already happened in {@link setOrgDefault}; success clears
   *  {@link syncError}, failure sets an honest message (the "for everyone"
   *  save is NOT silently treated as durably saved platform-wide). */
  private pushOrgDefault(next: AppearancePreferences): void {
    if (typeof fetch !== 'function') return;
    fetch(`${BFF}${ORG_DEFAULT_WRITE_PATH}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: next }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`org default save failed (${res.status})`);
        this.syncError.set(null);
      })
      .catch(() => {
        this.syncError.set('Could not save the default for everyone — it only applied in this browser.');
      });
  }

  private reloadFromStorage(): void {
    this.customised = this.hasUserPrefs();
    this.current = this.resolveInitial();
    this.prefs.set({ ...this.current });
    this.prefsSubject.next({ ...this.current });
    this.apply();
  }

  private hasUserPrefs(): boolean {
    try {
      return localStorage.getItem(PREFS_STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  private resolveInitial(): AppearancePreferences {
    const saved = this.loadUserPrefs();
    if (saved) {
      this.customised = true;
      return { ...this.resolveDefault(), ...saved };
    }
    this.customised = false;
    return this.resolveDefault();
  }

  /** built-in ← org/admin default. */
  private resolveDefault(): AppearancePreferences {
    return { ...BUILTIN_DEFAULT, ...this.loadOrgDefault() };
  }

  private loadUserPrefs(): Partial<AppearancePreferences> | null {
    try {
      const raw = localStorage.getItem(PREFS_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<AppearancePreferences>) : null;
    } catch {
      return null;
    }
  }

  private loadOrgDefault(): AppearancePreferences {
    try {
      const raw = localStorage.getItem(ORG_DEFAULT_LOCAL_KEY);
      if (raw) return { ...BUILTIN_DEFAULT, ...(JSON.parse(raw) as Partial<AppearancePreferences>) };
    } catch {
      /* ignore */
    }
    return { ...BUILTIN_DEFAULT };
  }

  /**
   * Apply the current prefs to this remote's root element(s) by setting
   * `data-*` attributes + CSS custom properties. Scoped to REMOTE_ROOT_SELECTOR
   * so the host shell / sibling remotes are untouched. Idempotent and safe to
   * call repeatedly (e.g. after a new root mounts).
   */
  apply(): void {
    if (typeof document === 'undefined') return;
    const roots = Array.from(document.querySelectorAll<HTMLElement>(REMOTE_ROOT_SELECTOR));
    for (const root of roots) {
      (Object.keys(DATA_ATTR) as (keyof typeof DATA_ATTR)[]).forEach((key) => {
        const value = this.current[key];
        const attr = DATA_ATTR[key];
        if (typeof value === 'boolean') {
          if (value) root.setAttribute(attr, 'on');
          else root.removeAttribute(attr);
        } else {
          root.setAttribute(attr, String(value));
        }
      });
      // CSS custom properties so nested components inherit text size + corners.
      root.style.setProperty('--mastodon-text-size', TEXT_SIZE_REM[this.current.textSize]);
      root.style.setProperty(
        '--mastodon-media-radius',
        this.current.mediaCorners === 'square' ? '0' : 'var(--mastodon-radius-base, 0.75rem)',
      );
      // Chat bubble accents: free-form colours, so ONLY a validated #rrggbb is
      // ever written as a var. Unset ('') / invalid removes the var so the SCSS
      // fallbacks render exactly today's look.
      this.applyChatAccentVar(root, '--mastodon-chat-accent-mine', this.current.chatAccentMine);
      this.applyChatAccentVar(root, '--mastodon-chat-accent-theirs', this.current.chatAccentTheirs);
    }
  }

  private applyChatAccentVar(root: HTMLElement, cssVar: string, value: string): void {
    if (typeof value === 'string' && CHAT_ACCENT_HEX_RE.test(value)) root.style.setProperty(cssVar, value);
    else root.style.removeProperty(cssVar);
  }
}
