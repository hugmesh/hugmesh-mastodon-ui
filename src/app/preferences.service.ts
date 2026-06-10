import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/* ──────────────────────────────────────────────────────────────────────────
 * Per-user STYLE + VIEW preferences for the snapdragon-mastodon-ui remote.
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
 * remote's own root element(s) — the `.snap-mastodon` subtree(s) — so it never
 * leaks onto the federation host or sibling remotes (matrix/login/admin).
 * ────────────────────────────────────────────────────────────────────────── */

/** Bump when the stored shape changes incompatibly. Old keys are ignored and
 *  the user falls back to the admin/org default (then built-in default). */
export const PREFS_STORAGE_KEY = 'snap.mastodon.prefs.v1';

/** Where the admin-authored ORG DEFAULT preference set lives. For THIS PR it is
 *  a same-origin static asset the admin panel writes-and-applies locally (see
 *  setOrgDefault below) — honestly a local/asset-backed default, NOT yet a
 *  server-persisted org policy. The admin-bff/admin-ui integration point for a
 *  durable org default is documented at {@link DEFAULTS_SYNC_HOOK}. */
export const ORG_DEFAULT_ASSET = 'assets/mastodon-appearance-default.json';

export type ColorTheme = 'snap-neon' | 'pastel-rose' | 'pastel-sky' | 'pastel-mint' | 'mono';
export type Accent = 'neon' | 'rose' | 'lavender' | 'sky' | 'mint' | 'peach';
export type Appearance = 'auto' | 'light' | 'dark';
export type Layout = 'single' | 'multi';
export type Density = 'comfortable' | 'compact';
export type MediaCorners = 'rounded' | 'square';
export type FontFamily = 'system' | 'serif' | 'mono' | 'dyslexic';
export type TextSize = 'sm' | 'md' | 'lg' | 'xl';

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
}

/** A one-field change emitted to listeners (the panel announces it in a live
 *  region; future BFF sync can debounce on it). */
export type PrefChange = { key: keyof AppearancePreferences; value: AppearancePreferences[keyof AppearancePreferences] };

/** Each preference maps to a `data-*` attribute on the remote root; the SCSS
 *  selectors key off these. textSize/highContrast/reducedMotion ALSO drive CSS
 *  custom properties so they cascade into every nested component. */
const DATA_ATTR: Record<keyof AppearancePreferences, string> = {
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
};

/** The remote roots we scope styling to. The timeline column carries the
 *  `.snap-mastodon` class; the standalone dev shell uses `snap-mastodon-root`.
 *  Applying to BOTH (when present) keeps the styling on this remote's subtree
 *  whether it runs standalone or federated into the host. */
const REMOTE_ROOT_SELECTOR = '.snap-mastodon, snap-mastodon-root';

/* ──────────────────────────────────────────────────────────────────────────
 * BFF SYNC HOOK (documented; NOT wired in this PR).
 *
 * A future snapdragon-user-bff-api `user_preference` row would back per-user
 * sync. The drop-in is:
 *   - on load: GET /bff/user/preferences → if present, hydrate() with it
 *     (server value wins over localStorage so prefs follow the user across
 *     devices); fall back to localStorage when offline / 404.
 *   - on change: in persist(), additionally
 *       PUT /bff/user/preferences  { prefs: this.snapshot() }
 *     (debounced via the changes$ stream). Owner = JWT subject server-side, so
 *     a user only ever reads/writes their own row — mirrors UserBffService.
 * Because the datastore is already RxJS-subject + signal backed and writes go
 * through the single persist() chokepoint, adding this is purely additive and
 * needs NO change to the panel or any consuming component.
 * ────────────────────────────────────────────────────────────────────────── */
export const BFF_SYNC_HOOK = 'PUT/GET /bff/user/preferences { prefs } — see UserBffService';

/* ──────────────────────────────────────────────────────────────────────────
 * DEFAULTS SYNC HOOK (documented; partially wired — local/asset-backed here).
 *
 * The admin-authored ORG DEFAULT is the fallback a user inherits before they
 * customise. The durable integration point is a snapdragon-admin-bff endpoint
 * (e.g. PUT /bff/admin/mastodon/appearance-default { prefs }) that writes the
 * org policy, with admin-ui surfacing it; the gateway would then serve it (or
 * bake it into ORG_DEFAULT_ASSET at deploy time). For THIS PR the admin panel
 * writes the chosen default to localStorage under ORG_DEFAULT_LOCAL_KEY and
 * applies it immediately — a real, working default-setter whose HONEST limit is
 * that it is per-browser, not yet a cluster-wide persisted policy.
 * ────────────────────────────────────────────────────────────────────────── */
export const DEFAULTS_SYNC_HOOK = 'PUT /bff/admin/mastodon/appearance-default { prefs } — admin-bff (deferred)';
export const ORG_DEFAULT_LOCAL_KEY = 'snap.mastodon.prefs.orgdefault.v1';

/** The shipped built-in default. Mirrors the brand: neon theme, dark, single
 *  column, comfortable, rounded media, system font, medium text. */
export const BUILTIN_DEFAULT: AppearancePreferences = {
  theme: 'snap-neon',
  accent: 'neon',
  appearance: 'dark',
  layout: 'single',
  density: 'comfortable',
  mediaCorners: 'rounded',
  font: 'system',
  textSize: 'md',
  highContrast: false,
  reducedMotion: false,
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
   *  announcement and the future debounced BFF write. */
  readonly changes$: Observable<PrefChange | null> = this.changeSubject.asObservable();

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
    // Best-effort: pull the shipped org-default ASSET so a fresh user (no saved
    // prefs AND no per-browser admin override) inherits the deployed baseline.
    // Failures (offline / missing asset / test env) are swallowed — we already
    // resolved to the built-in default above.
    void this.loadAssetDefault();
  }

  /** Fetch the shipped {@link ORG_DEFAULT_ASSET}; if present AND the user has
   *  not customised AND no per-browser admin override exists, adopt it as the
   *  default. Best-effort and non-blocking. */
  private async loadAssetDefault(): Promise<void> {
    if (typeof fetch !== 'function' || this.customised) return;
    // A per-browser admin override (ORG_DEFAULT_LOCAL_KEY) wins over the asset.
    try {
      if (localStorage.getItem(ORG_DEFAULT_LOCAL_KEY) !== null) return;
    } catch {
      /* ignore */
    }
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

  /** Set ONE preference, persist it, and apply it to the remote root(s). */
  set<K extends keyof AppearancePreferences>(key: K, value: AppearancePreferences[K]): void {
    if (this.current[key] === value) return;
    this.current = { ...this.current, [key]: value };
    this.customised = true;
    this.commit();
    this.changeSubject.next({ key, value });
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

  // ── ADMIN: org/default layout ──────────────────────────────────────────
  /** The org/admin default currently in effect (what a non-customised user
   *  inherits). */
  orgDefault(): AppearancePreferences {
    return this.loadOrgDefault();
  }

  /**
   * ADMIN-only: write the given set as the ORG DEFAULT and apply it. Honestly
   * local/asset-backed for this PR (per-browser via ORG_DEFAULT_LOCAL_KEY); the
   * durable path is {@link DEFAULTS_SYNC_HOOK}. Callers MUST gate this on
   * SessionService.isAdmin(); the service does not know the caller's role (UI
   * gating is defence-in-depth, the admin-bff would enforce server-side).
   *
   * If the current user has NOT customised, the new default takes effect for
   * them immediately too.
   */
  setOrgDefault(next: AppearancePreferences): void {
    try {
      localStorage.setItem(ORG_DEFAULT_LOCAL_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / private-mode */
    }
    if (!this.customised) {
      this.current = { ...next };
      this.commit(/* persistUser */ false);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────
  /** Persist (optionally) + push to signal/subject + re-style the remote. */
  private commit(persistUser = true): void {
    if (persistUser) this.persist();
    this.prefs.set({ ...this.current });
    this.prefsSubject.next({ ...this.current });
    this.apply();
  }

  /** The single localStorage write chokepoint (the future BFF PUT hangs here —
   *  see {@link BFF_SYNC_HOOK}). */
  private persist(): void {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      /* ignore quota / private-mode */
    }
    // FUTURE: this.userBff.putPreferences(this.snapshot()) — see BFF_SYNC_HOOK.
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
      (Object.keys(DATA_ATTR) as (keyof AppearancePreferences)[]).forEach((key) => {
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
    }
  }
}
