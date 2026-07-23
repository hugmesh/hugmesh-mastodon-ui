import { Injectable, InjectionToken, inject } from '@angular/core';

/** Base URL of the Mastodon instance (mastodon.hugmesh.systems). Only
 *  consulted when {@link MASTODON_PROXY_MODE} is off — the default (proxy ON)
 *  path never reaches this directly, it goes through the user-bff-api hsproxy
 *  instead (see {@link MASTODON_PROXY_MODE}). Reuses the
 *  globalThis.__HUG_MASTODON_URL__ fallback so the host can override the
 *  target at runtime. */
export const MASTODON_BASE_URL = new InjectionToken<string>('MASTODON_BASE_URL', {
  factory: () => (globalThis as any).__HUG_MASTODON_URL__ ?? 'https://mastodon.hugmesh.systems',
});

/** Same-origin BFF base (the fe-gateway proxies /bff/user/** to
 *  hugmesh-user-bff-api). Mirrors UserBffService's __HUG_BFF_URL__ runtime
 *  override; empty string = same origin. The AI-cloak media proxy lives here so
 *  the bytes are poisoned BEFORE the homeserver ingests/re-encodes them — a
 *  direct /api/v2/media upload would let the clean original federate first. */
export const BFF_BASE_URL = new InjectionToken<string>('BFF_BASE_URL', {
  factory: () => (globalThis as any).__HUG_BFF_URL__ ?? '',
});

/** D6 homeserver BFF-proxy cutover flag (per-UI, NOW DEFAULT TRUE).
 *
 *  When TRUE (the default, post-cutover): every Mastodon REST call is routed
 *  same-origin through the hugmesh-user-bff-api reverse proxy at
 *  `${BFF_BASE_URL}/bff/user/mastodon` (user-bff-api `MastodonProxyController`).
 *  The proxy strips the prefix and forwards the native `/api/...` path + query
 *  verbatim, OWNS the upstream homeserver token (AES-256-GCM custody, injected
 *  server-side), and is a Casdoor OAuth2 *resource server* — so the client sends
 *  the HttpOnly `bff_` cookie (`credentials: 'include'`), which the fe-gateway's
 *  BffCookieToBearerWebFilter converts to the Casdoor-JWT bearer server-side,
 *  and the browser NEVER holds or forwards the per-service Mastodon token (the
 *  proxy injects its own upstream token). CSRF is disabled by design on the
 *  bearer chain, so no X-CSRF / double-submit header is required on mutating
 *  calls (contract §3/§4).
 *
 *  When FALSE (legacy escape hatch): the client talks DIRECTLY to the homeserver
 *  at {@link MASTODON_BASE_URL} with no Authorization header — the homeserver
 *  token is no longer held in the browser, so this path is unauthenticated and
 *  only useful for public/read-only diagnostics.
 *
 *  Runtime override hook `globalThis.__HUG_MASTODON_PROXY_MODE__` mirrors the
 *  __HUG_*__ convention so the host can flip this per deployment without a
 *  rebuild; semantically this is `environment.ui.mastodonProxyMode`. */
export const MASTODON_PROXY_MODE = new InjectionToken<boolean>('MASTODON_PROXY_MODE', {
  factory: () => (globalThis as any).__HUG_MASTODON_PROXY_MODE__ ?? true,
});

// ---------------------------------------------------------------------------
// Entities (https://docs.joinmastodon.org/entities/)
// ---------------------------------------------------------------------------

export interface CustomEmoji {
  shortcode: string;
  url: string;
  static_url: string;
  visible_in_picker: boolean;
}

export interface AccountField {
  name: string;
  value: string;
  verified_at: string | null;
}

export interface Account {
  id: string;
  username: string;
  acct: string;
  url: string;
  display_name: string;
  note: string;
  avatar: string;
  avatar_static: string;
  header: string;
  header_static: string;
  locked: boolean;
  bot: boolean;
  created_at: string;
  followers_count: number;
  following_count: number;
  statuses_count: number;
  fields: AccountField[];
  emojis: CustomEmoji[];
  /** ASCII screen-reader name (hugmesh extension). Arrives over the wire in
   *  the homeserver/BFF Account JSON as snake_case `screen_reader_name`, like
   *  every other Account field (`display_name`, `statuses_count`, …) — the
   *  service parses Account JSON via a raw `as Account` cast with NO
   *  snake_case→camelCase remapping, so this MUST stay snake_case to actually
   *  populate at runtime. NOT part of the upstream Mastodon Account entity, so
   *  it is optional/absent for homeserver-native responses — when present it is
   *  what {@link accessibleName} announces for a non-ASCII `display_name`. */
  screen_reader_name?: string | null;
}

export interface Relationship {
  id: string;
  following: boolean;
  followed_by: boolean;
  requested: boolean;
  blocking: boolean;
  muting: boolean;
  showing_reblogs: boolean;
  notifying: boolean;
}

export interface MediaAttachmentMetaDimensions {
  width: number;
  height: number;
}

export interface MediaAttachment {
  id: string;
  type: 'image' | 'video' | 'gifv' | 'audio' | 'unknown';
  url: string | null;
  preview_url: string | null;
  remote_url: string | null;
  description: string | null;
  blurhash: string | null;
  meta: {
    original?: MediaAttachmentMetaDimensions;
    small?: MediaAttachmentMetaDimensions;
    focus?: { x: number; y: number };
  } | null;
}

// ---------------------------------------------------------------------------
// AI-cloak (server-side, poison-before-ingest via the BFF media proxy)
// ---------------------------------------------------------------------------

/** The cloak strength requested on upload. `none` = forward straight through
 *  (opt-out / non-image / fallback). Glaze is the default; Nightshade is the
 *  slower opt-up. These mirror the BFF's `mode` field. */
export type CloakMode = 'glaze' | 'nightshade' | 'light' | 'none';

/** Outcome of the round-trip survival check the BFF runs AFTER the homeserver
 *  has produced its served bytes. `protected` only when the perturbation
 *  actually survived; honest copy never promises more than the worker proved. */
export type CloakStatus = 'pending' | 'protected' | 'degraded' | 'skipped' | 'failed';

/** The active processing backend reported by the poisoner worker's /health,
 *  proxied through the BFF capability endpoint. `none` = heavy tier absent on
 *  this cluster (Pi5-only) → the composer must warn-before-post, not pretend. */
export type CloakBackend = 'cuda' | 'rocm' | 'cpu' | 'none';

/** GET /bff/user/media/capability — drives the up-front shield state + the
 *  honest expected-time/strength hint, queried when the composer opens. */
export interface CloakCapability {
  /** True only when the worker Service has Ready endpoints AND the feature flag
   *  is on; false means warn-before-post for an opted-in user. */
  available: boolean;
  backend: CloakBackend;
  /** Default mode the server applies when the user has not opted out. */
  defaultMode: CloakMode;
  /** Rough human-readable per-image time for the active backend (e.g. "~1 min"). */
  expectedTime?: string;
}

/** GET /bff/user/media/status/{ref} — the badge polls this until the round-trip
 *  survival check resolves. `mode` echoes what was applied so the badge can
 *  label "AI-cloak: Glaze" vs "Off" truthfully. */
export interface CloakResult {
  ref: string;
  status: CloakStatus;
  mode: CloakMode;
  backend: CloakBackend;
}

/** POST /bff/user/media/upload response: the homeserver MediaAttachment exactly
 *  as a direct /api/v2/media upload would return (so downstream compose/submit
 *  is untouched), PLUS the poison decision the badge renders from. */
export interface ProtectedMediaAttachment extends MediaAttachment {
  /** Server-owned poison decision (source of truth for the badge), echoed on
   *  the upload response. `ref` keys the status-polling endpoint. */
  cloak?: CloakResult;
}

export interface PollOption {
  title: string;
  votes_count: number | null;
}

export interface Poll {
  id: string;
  expires_at: string | null;
  expired: boolean;
  multiple: boolean;
  votes_count: number;
  voters_count: number | null;
  voted?: boolean;
  own_votes?: number[];
  options: PollOption[];
  emojis: CustomEmoji[];
}

export interface StatusMention {
  id: string;
  username: string;
  url: string;
  acct: string;
}

export interface StatusTag {
  name: string;
  url: string;
}

export interface PreviewCard {
  url: string;
  title: string;
  description: string;
  type: 'link' | 'photo' | 'video' | 'rich';
  image: string | null;
  provider_name: string;
  html: string;
}

export interface Status {
  id: string;
  uri: string;
  url: string | null;
  created_at: string;
  edited_at: string | null;
  content: string;
  visibility: 'public' | 'unlisted' | 'private' | 'direct';
  sensitive: boolean;
  spoiler_text: string;
  language: string | null;
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
  favourited?: boolean;
  reblogged?: boolean;
  bookmarked?: boolean;
  pinned?: boolean;
  muted?: boolean;
  account: Account;
  media_attachments: MediaAttachment[];
  mentions: StatusMention[];
  tags: StatusTag[];
  emojis: CustomEmoji[];
  reblog: Status | null;
  in_reply_to_id: string | null;
  in_reply_to_account_id: string | null;
  poll: Poll | null;
  card: PreviewCard | null;
}

/** Back-compat alias: the original remote exposed a thin `Toot`. */
export type Toot = Status;

export interface Context {
  ancestors: Status[];
  descendants: Status[];
}

export interface Notification {
  id: string;
  type: 'mention' | 'status' | 'reblog' | 'follow' | 'follow_request' | 'favourite' | 'poll' | 'update';
  created_at: string;
  account: Account;
  status: Status | null;
}

export interface TagHistory {
  day: string;
  uses: string;
  accounts: string;
}

export interface Tag {
  name: string;
  url: string;
  following?: boolean;
  history: TagHistory[];
}

export interface SearchResults {
  accounts: Account[];
  statuses: Status[];
  hashtags: Tag[];
}

export interface Conversation {
  id: string;
  unread: boolean;
  accounts: Account[];
  last_status: Status | null;
}

export interface MastodonList {
  id: string;
  title: string;
  replies_policy: 'followed' | 'list' | 'none';
  exclusive?: boolean;
}

export interface PostStatusParams {
  status: string;
  in_reply_to_id?: string;
  media_ids?: string[];
  poll?: { options: string[]; expires_in: number; multiple?: boolean };
  sensitive?: boolean;
  spoiler_text?: string;
  visibility?: 'public' | 'unlisted' | 'private' | 'direct';
  language?: string;
}

export interface TimelineParams {
  max_id?: string;
  since_id?: string;
  min_id?: string;
  limit?: number;
  local?: boolean;
  remote?: boolean;
  only_media?: boolean;
}

/** A page of statuses plus the cursors parsed from the Link header (used for
 *  favourites/bookmarks where the response ids are not status ids). */
export interface StatusPage {
  statuses: Status[];
  nextMaxId: string | null;
  prevMinId: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Thin Mastodon REST API wrapper. Auth rides ENTIRELY on the HttpOnly `bff_`
 * session cookie: every REST call goes same-origin through the user-bff-api
 * hsproxy (`/bff/user/mastodon`), which OWNS the per-service Mastodon token in
 * server-side custody and injects it upstream. The browser never holds, reads,
 * or forwards a homeserver access token. The module never renders its own login
 * form.
 *
 * Requests target mastodon.hugmesh.systems via the BFF hsproxy by default; the
 * legacy direct-homeserver base (injected MASTODON_BASE_URL) remains only as an
 * unauthenticated escape hatch when {@link MASTODON_PROXY_MODE} is flipped off.
 */
@Injectable({ providedIn: 'root' })
export class MastodonService {
  private readonly homeserverBaseUrl = inject(MASTODON_BASE_URL);
  private readonly bffBaseUrl = inject(BFF_BASE_URL);
  private readonly proxyMode = inject(MASTODON_PROXY_MODE);

  /** The base every Mastodon REST call is built against. By default (proxy ON)
   *  this is the same-origin user-bff-api hsproxy prefix, so the native
   *  `/api/...` sub-paths below are forwarded verbatim by the BFF; when the flag
   *  is off it falls back to the (unauthenticated) homeserver base. */
  private get baseUrl(): string {
    return this.proxyMode ? `${this.bffBaseUrl}/bff/user/mastodon` : this.homeserverBaseUrl;
  }

  /** Retained as a no-op for host back-compat: the browser must NOT supply a
   *  homeserver access token — the hsproxy injects the server-held token. */
  setAccessToken(_token: string): void {
    // intentionally a no-op; auth is the HttpOnly bff_ cookie, see headers()
  }

  private headers(): Record<string, string> {
    // The user-bff-api hsproxy OWNS the upstream homeserver token and is a
    // Casdoor OAuth2 resource server — authenticate with the HttpOnly bff_
    // cookie (the fe-gateway's BffCookieToBearerWebFilter converts it to the
    // bearer server-side), exactly like the BFF media/cloak calls below, and
    // NEVER attach a per-service Mastodon token. The browser carries auth in the
    // cookie (see bffCredentials), so no Authorization header is ever set. CSRF
    // is disabled on the bearer chain, so mutating calls need no X-CSRF header.
    return this.bffHeaders();
  }

  /** Header surface for a BFF call. Auth rides on the HttpOnly bff_ cookie
   *  (see {@link bffCredentials}), NOT an Authorization header, so this is empty;
   *  callers spread it so e.g. multipart uploads still omit Content-Type. */
  private bffHeaders(): Record<string, string> {
    return {};
  }

  /** Send the HttpOnly bff_ cookie on a same-origin BFF call so the gateway can
   *  derive the bearer; the legacy direct-homeserver path stays cookie-free. */
  private get bffCredentials(): RequestCredentials | undefined {
    return this.proxyMode ? 'include' : undefined;
  }

  // ----- low-level helpers ------------------------------------------------

  /** Build a query string from a flat params object. Arrays become `key[]=`
   *  repeated params (Mastodon's bracketed-array convention). */
  private qs(params?: Record<string, unknown>): string {
    if (!params) return '';
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) sp.append(`${key}[]`, String(v));
      } else {
        sp.append(key, String(value));
      }
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
  }

  private async get<T>(path: string, params?: Record<string, unknown>, fallback?: T): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}${this.qs(params)}`, {
      headers: this.headers(),
      credentials: this.bffCredentials,
    });
    if (!r.ok) {
      if (fallback !== undefined) return fallback;
      throw new Error(`GET ${path} failed: ${r.status}`);
    }
    return (await r.json()) as T;
  }

  /** GET returning the parsed body plus Link-header cursors. */
  private async getPaged(path: string, params?: Record<string, unknown>): Promise<StatusPage> {
    const r = await fetch(`${this.baseUrl}${path}${this.qs(params)}`, {
      headers: this.headers(),
      credentials: this.bffCredentials,
    });
    if (!r.ok) return { statuses: [], nextMaxId: null, prevMinId: null };
    const statuses = (await r.json()) as Status[];
    const link = r.headers.get('Link') ?? '';
    return {
      statuses,
      nextMaxId: this.parseLinkParam(link, 'next', 'max_id'),
      prevMinId: this.parseLinkParam(link, 'prev', 'min_id'),
    };
  }

  /** Extract a query param (e.g. max_id) from a rel link in an RFC5988 Link header. */
  private parseLinkParam(link: string, rel: string, param: string): string | null {
    for (const part of link.split(',')) {
      const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
      if (!m) continue;
      if (m[2] !== rel) continue;
      try {
        const url = new URL(m[1]);
        return url.searchParams.get(param);
      } catch {
        return null;
      }
    }
    return null;
  }

  private async postJson<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers(), ...(extraHeaders ?? {}) },
      credentials: this.bffCredentials,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${path} failed: ${r.status}`);
    const text = await r.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ----- account / session ------------------------------------------------

  async verifyCredentials(): Promise<Account | null> {
    const r = await fetch(`${this.baseUrl}/api/v1/accounts/verify_credentials`, {
      headers: this.headers(),
      credentials: this.bffCredentials,
    });
    if (r.status === 401) return null;
    return r.ok ? ((await r.json()) as Account) : null;
  }

  // ----- timelines --------------------------------------------------------

  async homeTimeline(params?: TimelineParams): Promise<Status[]> {
    return this.get<Status[]>('/api/v1/timelines/home', this.timelineQuery(params, ['max_id', 'since_id', 'min_id', 'limit']), []);
  }

  async communityTimeline(params?: TimelineParams): Promise<Status[]> {
    return this.get<Status[]>(
      '/api/v1/timelines/public',
      { local: true, ...this.timelineQuery(params, ['only_media', 'max_id', 'since_id', 'min_id', 'limit']) },
      [],
    );
  }

  async publicTimeline(params?: TimelineParams): Promise<Status[]> {
    return this.get<Status[]>(
      '/api/v1/timelines/public',
      this.timelineQuery(params, ['remote', 'only_media', 'max_id', 'since_id', 'min_id', 'limit']),
      [],
    );
  }

  async hashtagTimeline(
    tag: string,
    params?: TimelineParams & { any?: string[]; all?: string[]; none?: string[] },
  ): Promise<Status[]> {
    const query = this.timelineQuery(params, ['local', 'remote', 'only_media', 'max_id', 'since_id', 'min_id', 'limit']);
    if (params?.any) query['any'] = params.any;
    if (params?.all) query['all'] = params.all;
    if (params?.none) query['none'] = params.none;
    return this.get<Status[]>(`/api/v1/timelines/tag/${encodeURIComponent(tag.replace(/^#/, ''))}`, query, []);
  }

  async listTimeline(listId: string, params?: TimelineParams): Promise<Status[]> {
    return this.get<Status[]>(
      `/api/v1/timelines/list/${encodeURIComponent(listId)}`,
      this.timelineQuery(params, ['max_id', 'since_id', 'min_id', 'limit']),
      [],
    );
  }

  /** Pick only the allowed timeline params into a plain query object. */
  private timelineQuery(params: object | undefined, keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!params) return out;
    const src = params as Record<string, unknown>;
    for (const k of keys) {
      const v = src[k];
      if (v !== undefined && v !== null) out[k] = v;
    }
    return out;
  }

  // ----- single statuses + context ---------------------------------------

  async getStatus(id: string): Promise<Status> {
    return this.get<Status>(`/api/v1/statuses/${encodeURIComponent(id)}`);
  }

  async getContext(id: string): Promise<Context> {
    return this.get<Context>(`/api/v1/statuses/${encodeURIComponent(id)}/context`, undefined, {
      ancestors: [],
      descendants: [],
    });
  }

  // ----- create / interact -----------------------------------------------

  async postStatus(params: PostStatusParams, idempotencyKey?: string): Promise<Status> {
    return this.postJson<Status>(
      '/api/v1/statuses',
      params,
      idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    );
  }

  async favourite(id: string): Promise<Status> {
    return this.postJson<Status>(`/api/v1/statuses/${encodeURIComponent(id)}/favourite`);
  }

  async unfavourite(id: string): Promise<Status> {
    return this.postJson<Status>(`/api/v1/statuses/${encodeURIComponent(id)}/unfavourite`);
  }

  async reblog(id: string, visibility?: 'public' | 'unlisted' | 'private'): Promise<Status> {
    return this.postJson<Status>(
      `/api/v1/statuses/${encodeURIComponent(id)}/reblog`,
      visibility ? { visibility } : undefined,
    );
  }

  async unreblog(id: string): Promise<Status> {
    return this.postJson<Status>(`/api/v1/statuses/${encodeURIComponent(id)}/unreblog`);
  }

  async bookmark(id: string): Promise<Status> {
    return this.postJson<Status>(`/api/v1/statuses/${encodeURIComponent(id)}/bookmark`);
  }

  async unbookmark(id: string): Promise<Status> {
    return this.postJson<Status>(`/api/v1/statuses/${encodeURIComponent(id)}/unbookmark`);
  }

  async voteOnPoll(pollId: string, choices: number[]): Promise<Poll> {
    // choices submitted as the array form param choices[]=0&choices[]=2
    return this.postJson<Poll>(`/api/v1/polls/${encodeURIComponent(pollId)}/votes`, { choices });
  }

  // ----- media ------------------------------------------------------------

  async uploadMedia(file: File, description?: string, focus?: string): Promise<MediaAttachment> {
    const form = new FormData();
    form.append('file', file);
    if (description) form.append('description', description);
    if (focus) form.append('focus', focus);
    const r = await fetch(`${this.baseUrl}/api/v2/media`, {
      method: 'POST',
      headers: this.headers(), // do NOT set Content-Type; the browser adds the multipart boundary
      credentials: this.bffCredentials,
      body: form,
    });
    // 200 = processed synchronously, 202 = accepted (async, url null until ready)
    if (!r.ok && r.status !== 202) throw new Error(`uploadMedia failed: ${r.status}`);
    return (await r.json()) as MediaAttachment;
  }

  async getMedia(id: string): Promise<MediaAttachment> {
    // 200 = ready (url populated), 206 = still processing
    return this.get<MediaAttachment>(`/api/v1/media/${encodeURIComponent(id)}`);
  }

  // ----- AI-cloak media (poison-before-ingest via the BFF proxy) -----------

  /**
   * Upload `file` through the BFF media proxy so it is AI-cloaked (Glaze/
   * Nightshade-style) BEFORE the homeserver ingests/re-encodes/federates it,
   * instead of POSTing straight to /api/v2/media (which would let the clean
   * original federate first — the cloak would then be theatre).
   *
   * The BFF poisons the original + every served size, performs the REAL
   * homeserver upload of the poisoned bytes, and returns the resulting
   * MediaAttachment exactly as the homeserver would have — so the caller's
   * downstream submit()/media_ids logic is UNTOUCHED. The extra `cloak` field
   * carries the server-owned poison decision the badge renders from.
   *
   * Honest contract: a `protected` status means the perturbation survived the
   * homeserver round-trip; `degraded`/`skipped`/`failed` are surfaced as-is —
   * the UI never upgrades the wording the server reports.
   */
  async uploadMediaProtected(
    file: File,
    mode: CloakMode,
    description?: string,
  ): Promise<ProtectedMediaAttachment> {
    const form = new FormData();
    form.append('file', file);
    form.append('platform', 'mastodon');
    form.append('mode', mode);
    if (description) form.append('description', description);
    const r = await fetch(`${this.bffBaseUrl}/bff/user/media/upload`, {
      method: 'POST',
      headers: this.bffHeaders(), // do NOT set Content-Type; the browser adds the multipart boundary
      credentials: 'include', // HttpOnly bff_ cookie → gateway derives the bearer
      body: form,
    });
    // 200 = processed, 202 = accepted (placeholder-then-replace for the slow tier)
    if (!r.ok && r.status !== 202) throw new Error(`uploadMediaProtected failed: ${r.status}`);
    return (await r.json()) as ProtectedMediaAttachment;
  }

  /** GET /bff/user/media/capability — the worker backend + whether the heavy
   *  tier is present, so the composer renders an honest shield state up front
   *  (Available vs Unavailable) rather than after the upload. Falls back to an
   *  unavailable/none capability if the BFF is unreachable. */
  async cloakCapability(): Promise<CloakCapability> {
    try {
      const r = await fetch(`${this.bffBaseUrl}/bff/user/media/capability`, {
        headers: this.bffHeaders(),
        credentials: 'include', // HttpOnly bff_ cookie → gateway derives the bearer
      });
      if (!r.ok) return { available: false, backend: 'none', defaultMode: 'glaze' };
      return (await r.json()) as CloakCapability;
    } catch {
      return { available: false, backend: 'none', defaultMode: 'glaze' };
    }
  }

  /** GET /bff/user/media/status/{ref} — poll the poison decision so the badge
   *  flips from pending → protected/degraded once the round-trip survival check
   *  resolves server-side. This is a BFF path (bff_ cookie), not a homeserver one. */
  async cloakStatus(ref: string): Promise<CloakResult> {
    const r = await fetch(`${this.bffBaseUrl}/bff/user/media/status/${encodeURIComponent(ref)}`, {
      headers: this.bffHeaders(),
      credentials: 'include', // HttpOnly bff_ cookie → gateway derives the bearer
    });
    if (!r.ok) throw new Error(`cloakStatus failed: ${r.status}`);
    return (await r.json()) as CloakResult;
  }

  // ----- notifications ----------------------------------------------------

  async notifications(params?: {
    max_id?: string;
    since_id?: string;
    min_id?: string;
    limit?: number;
    types?: string[];
    exclude_types?: string[];
    account_id?: string;
  }): Promise<Notification[]> {
    return this.get<Notification[]>('/api/v1/notifications', params as Record<string, unknown>, []);
  }

  async dismissNotification(id: string): Promise<void> {
    await this.postJson<void>(`/api/v1/notifications/${encodeURIComponent(id)}/dismiss`);
  }

  async clearNotifications(): Promise<void> {
    await this.postJson<void>('/api/v1/notifications/clear');
  }

  // ----- accounts / relationships ----------------------------------------

  async getAccount(id: string): Promise<Account> {
    return this.get<Account>(`/api/v1/accounts/${encodeURIComponent(id)}`);
  }

  async lookupAccount(acct: string): Promise<Account> {
    return this.get<Account>('/api/v1/accounts/lookup', { acct });
  }

  async accountStatuses(
    id: string,
    params?: {
      exclude_replies?: boolean;
      only_media?: boolean;
      pinned?: boolean;
      exclude_reblogs?: boolean;
      max_id?: string;
      min_id?: string;
      limit?: number;
    },
  ): Promise<Status[]> {
    return this.get<Status[]>(`/api/v1/accounts/${encodeURIComponent(id)}/statuses`, params as Record<string, unknown>, []);
  }

  async getRelationships(ids: string[]): Promise<Relationship[]> {
    return this.get<Relationship[]>('/api/v1/accounts/relationships', { id: ids }, []);
  }

  async followAccount(id: string): Promise<Relationship> {
    return this.postJson<Relationship>(`/api/v1/accounts/${encodeURIComponent(id)}/follow`);
  }

  async unfollowAccount(id: string): Promise<Relationship> {
    return this.postJson<Relationship>(`/api/v1/accounts/${encodeURIComponent(id)}/unfollow`);
  }

  // ----- search -----------------------------------------------------------

  async search(
    q: string,
    opts?: {
      type?: 'accounts' | 'hashtags' | 'statuses';
      resolve?: boolean;
      following?: boolean;
      limit?: number;
      offset?: number;
      account_id?: string;
    },
  ): Promise<SearchResults> {
    return this.get<SearchResults>(
      '/api/v2/search',
      { q, ...(opts as Record<string, unknown>) },
      { accounts: [], statuses: [], hashtags: [] },
    );
  }

  // ----- favourites / bookmarks (Link-header paginated) -------------------

  async favouritesList(params?: { max_id?: string; min_id?: string; limit?: number }): Promise<Status[]> {
    return this.get<Status[]>('/api/v1/favourites', params as Record<string, unknown>, []);
  }

  async favouritesPage(params?: { max_id?: string; min_id?: string; limit?: number }): Promise<StatusPage> {
    return this.getPaged('/api/v1/favourites', params as Record<string, unknown>);
  }

  async bookmarksList(params?: {
    max_id?: string;
    since_id?: string;
    min_id?: string;
    limit?: number;
  }): Promise<Status[]> {
    return this.get<Status[]>('/api/v1/bookmarks', params as Record<string, unknown>, []);
  }

  async bookmarksPage(params?: {
    max_id?: string;
    since_id?: string;
    min_id?: string;
    limit?: number;
  }): Promise<StatusPage> {
    return this.getPaged('/api/v1/bookmarks', params as Record<string, unknown>);
  }

  // ----- lists ------------------------------------------------------------

  async lists(): Promise<MastodonList[]> {
    return this.get<MastodonList[]>('/api/v1/lists', undefined, []);
  }

  /** Create a new user-defined list. POSTs `{ title }` to /api/v1/lists over the
   *  same cookie-authenticated hsproxy channel as every other mutating call (the
   *  HttpOnly bff_ cookie carries auth — see {@link bffCredentials}); no fallback,
   *  so a homeserver rejection propagates as a throw for the caller to surface.
   *  `replies_policy` defaults to Mastodon's own default ('list') so the created
   *  row matches what the index renders for a list made in the native client. */
  async createList(
    title: string,
    replies_policy: MastodonList['replies_policy'] = 'list',
  ): Promise<MastodonList> {
    return this.postJson<MastodonList>('/api/v1/lists', { title, replies_policy });
  }

  // ----- conversations (DMs) ---------------------------------------------

  async conversations(params?: {
    max_id?: string;
    since_id?: string;
    min_id?: string;
    limit?: number;
  }): Promise<Conversation[]> {
    return this.get<Conversation[]>('/api/v1/conversations', params as Record<string, unknown>, []);
  }

  // ----- trends / explore -------------------------------------------------

  async trendingStatuses(limit?: number, offset?: number): Promise<Status[]> {
    return this.get<Status[]>('/api/v1/trends/statuses', { limit, offset }, []);
  }

  async trendingTags(limit?: number, offset?: number): Promise<Tag[]> {
    return this.get<Tag[]>('/api/v1/trends/tags', { limit, offset }, []);
  }

  async trendingLinks(limit?: number, offset?: number): Promise<PreviewCard[]> {
    return this.get<PreviewCard[]>('/api/v1/trends/links', { limit, offset }, []);
  }
}
