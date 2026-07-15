import { Injectable } from '@angular/core';

/* ──────────────────────────────────────────────────────────────────────────
 * VN scene manifest — the flat-vector backgrounds + on-stage props the
 * visual-novel chat presentation (VnChatViewComponent) renders behind a DM
 * conversation. Everything is a LOCAL, shipped asset under
 * `assets/vn/scenes/` (schemaVersion-ed scenes.json + <6KB SVGs): no remote
 * fetches, no federated content — so the stage can never carry hostile bytes.
 * ────────────────────────────────────────────────────────────────────────── */

/** Base path every manifest `file` resolves against. Relative (not /-rooted)
 *  like PreferencesService's ORG_DEFAULT_ASSET so it works both standalone and
 *  federated into the host. */
export const VN_SCENES_BASE = 'assets/vn/scenes/';

/** The shipped manifest asset. */
export const VN_MANIFEST_URL = `${VN_SCENES_BASE}scenes.json`;

/** The scene every user starts on before choosing one (see
 *  PreferencesService's BUILTIN_DEFAULT.chatVnScene). */
export const VN_DEFAULT_SCENE_ID = 'vn_scene_bedroom';

/** Cap on ENABLED on-stage props — enforced at every boundary the pref list
 *  crosses (picker toggle, pref parse, stage render). 16 is double the shipped
 *  prop catalogue (8), so no legit combination is ever refused, while a
 *  corrupt/hostile stored `chatVnProps` string can never balloon the stage
 *  into rendering an unbounded image list. */
export const MAX_VN_PROPS = 16;

/** Manifest parse cap per collection. The shipped manifest carries 6 scenes +
 *  8 props; 64 leaves an order of magnitude of growth room while guaranteeing
 *  a corrupt/oversized scenes.json can never flood the picker/stage with
 *  thousands of entries. */
export const MAX_VN_MANIFEST_ENTRIES = 64;

export interface VnSceneEntry {
  id: string;
  displayName: string;
  file: string;
  tags: string[];
}

export interface VnPropEntry {
  id: string;
  displayName: string;
  file: string;
}

export interface VnSceneManifest {
  schemaVersion: number;
  scenes: VnSceneEntry[];
  props: VnPropEntry[];
}

/** The fail-soft value: an empty stage (no background, no props) rather than a
 *  broken view when the manifest asset is unreachable. */
export const EMPTY_VN_MANIFEST: VnSceneManifest = { schemaVersion: 1, scenes: [], props: [] };

/**
 * Loads + caches the VN scene manifest and resolves scene/prop asset URLs.
 * One in-flight/settled promise is shared by every caller (the chat view and
 * the picker both read it), so the manifest is fetched AT MOST once per
 * successful load; a failed load resolves to {@link EMPTY_VN_MANIFEST} and is
 * NOT cached, so a transient outage never permanently blanks the picker.
 */
@Injectable({ providedIn: 'root' })
export class SceneService {
  private manifestPromise: Promise<VnSceneManifest> | null = null;

  /** The cached manifest (fetched on first call). Fail-soft: resolves to
   *  {@link EMPTY_VN_MANIFEST} — never rejects. */
  manifest(): Promise<VnSceneManifest> {
    if (!this.manifestPromise) this.manifestPromise = this.load();
    return this.manifestPromise;
  }

  async scenes(): Promise<VnSceneEntry[]> {
    return (await this.manifest()).scenes;
  }

  async props(): Promise<VnPropEntry[]> {
    return (await this.manifest()).props;
  }

  /** Resolve a scene id to its asset URL, or null when the id is unknown
   *  (deleted/renamed scene in a stale saved preference — the caller falls
   *  back rather than rendering a broken image). */
  async sceneUrl(id: string): Promise<string | null> {
    const entry = (await this.scenes()).find((s) => s.id === id);
    return entry ? this.assetUrl(entry.file) : null;
  }

  /** Resolve a prop id to its asset URL, or null when unknown. */
  async propUrl(id: string): Promise<string | null> {
    const entry = (await this.props()).find((p) => p.id === id);
    return entry ? this.assetUrl(entry.file) : null;
  }

  /** URL of a manifest-relative asset file. */
  assetUrl(file: string): string {
    return `${VN_SCENES_BASE}${file}`;
  }

  private async load(): Promise<VnSceneManifest> {
    if (typeof fetch !== 'function') return EMPTY_VN_MANIFEST;
    try {
      const r = await fetch(VN_MANIFEST_URL);
      if (!r.ok) {
        this.manifestPromise = null; // do not cache a failure — retry next call
        return EMPTY_VN_MANIFEST;
      }
      const raw = (await r.json()) as Partial<VnSceneManifest>;
      return {
        schemaVersion: raw.schemaVersion ?? 1,
        // Parse-boundary cap (see MAX_VN_MANIFEST_ENTRIES): a corrupt manifest
        // degrades to its first 64 entries, never an unbounded render.
        scenes: Array.isArray(raw.scenes) ? raw.scenes.slice(0, MAX_VN_MANIFEST_ENTRIES) : [],
        props: Array.isArray(raw.props) ? raw.props.slice(0, MAX_VN_MANIFEST_ENTRIES) : [],
      };
    } catch {
      this.manifestPromise = null; // do not cache a failure — retry next call
      return EMPTY_VN_MANIFEST;
    }
  }
}
