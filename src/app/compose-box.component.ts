import { Component, EventEmitter, Input, Output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CloakCapability,
  CloakMode,
  CloakStatus,
  MastodonService,
  MediaAttachment,
  PostStatusParams,
  Status,
} from './mastodon.service';
import { SessionService } from './session.service';

/** The Mastodon visibility values that reach the wider fediverse: `public`
 *  (federated public timelines + boostable across instances) and `unlisted`
 *  (federated, just off the public timeline). A SOCIAL-DOMAIN-LOCKED user's
 *  posts are forced local-only by the homeserver's force-local MRF, so offering
 *  these as a live "reach" would be dishonest — they are disabled + helptext'd. */
const FEDERATED_VISIBILITIES: ReadonlyArray<NonNullable<PostStatusParams['visibility']>> = [
  'public',
  'unlisted',
];

/** Per-attachment AI-cloak state shown in the badge. `off` = the user opted out
 *  (or the file is non-image); `unavailable` = the heavy tier is absent and the
 *  attachment was forwarded un-cloaked; `pending` = the round-trip survival
 *  check has not resolved yet. The wording NEVER claims more than the server
 *  reported — honesty is the point of the feature. */
type AttachmentProtection = CloakStatus | 'off' | 'unavailable';

interface PendingMedia {
  id: string;
  preview: string | null;
  description: string;
  processing: boolean;
  filename: string;
  /** AI-cloak state for the badge (see {@link AttachmentProtection}). */
  protection: AttachmentProtection;
  /** Status-polling ref from the BFF poison decision (when cloaked). */
  cloakRef: string | null;
  /** The cloak mode actually applied (so the badge can label Glaze/Nightshade). */
  cloakMode: CloakMode;
}

/** localStorage key for the per-user AI-cloak default (default ON). Honestly a
 *  per-browser preference for this PR; the durable account-level value lives in
 *  the user-bff-api `user_preference` row keyed `media.poison.default` (the BFF
 *  capability response also carries the server defaultMode). The drop-in is to
 *  hydrate this from GET /bff/user/media/capability.defaultMode on init — which
 *  the composer already calls — and to PUT the toggle change to the BFF. */
export const POISON_DEFAULT_KEY = 'snap.mastodon.poison.default.v1';

/** Mastodon Compose / ComposeForm: text + CW + visibility + media + poll.
 *  Reused as the inline reply composer (in_reply_to_id). */
@Component({
  selector: 'snap-mastodon-compose-box',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './compose-box.component.html',
  styleUrl: './compose-box.component.scss',
})
export class ComposeBoxComponent {
  private readonly mastodon = inject(MastodonService);
  private readonly sessionSvc = inject(SessionService);

  /** SOCIAL LOCAL-ONLY ENFORCEMENT: mirrors the session `MASTODON_DOMAINLOCKED`
   *  marker. When true the composer forces the visibility/federation surface to
   *  LOCAL-ONLY — the federated-reach options (public/unlisted) are disabled +
   *  helptext'd and the local-only indicator reads "enforced", while LOCAL
   *  posting stays fully usable. The homeserver MRF is the real enforcer; this is
   *  defence-in-depth + honest signalling so the user is never invited to believe
   *  a post will federate when it provably will not. */
  readonly domainLocked = this.sessionSvc.mastodonDomainLocked;

  /** Per-instance unique id prefixes so <label for> bindings stay unique even
   *  when several compose boxes (e.g. inline replies) are on the page at once. */
  private static seq = 0;
  private readonly uid = `compose-${ComposeBoxComponent.seq++}`;
  readonly ids = {
    draft: `${this.uid}-draft`,
    spoiler: `${this.uid}-spoiler`,
    visibility: `${this.uid}-visibility`,
    charCount: `${this.uid}-char-count`,
    media: `${this.uid}-media`,
    pollOption: `${this.uid}-poll-option`,
    pollExpires: `${this.uid}-poll-expires`,
    localOnly: `${this.uid}-local-only`,
    localOnlyHelp: `${this.uid}-local-only-help`,
    visibilityHelp: `${this.uid}-visibility-help`,
  };

  @Input() inReplyToId: string | null = null;
  @Input() placeholder = "What's on your mind?";
  @Input() set defaultVisibility(v: PostStatusParams['visibility']) {
    // Honour a caller-supplied default, but never let it re-select a federated
    // reach for a domain-locked user (the reply composer passes the parent's
    // visibility, which could be 'public').
    if (v) this.visibility = this.domainLocked() && this.isFederatedVisibility(v) ? this.localSafeVisibility : v;
  }
  @Output() readonly posted = new EventEmitter<Status>();

  private readonly maxChars = 500;

  draft = '';
  spoilerText = '';
  visibility: NonNullable<PostStatusParams['visibility']> = 'public';
  pollMultiple = false;
  pollExpiresIn = 86400;

  readonly cwEnabled = signal(false);
  readonly pollEnabled = signal(false);
  readonly pollOptions = signal<string[]>(['', '']);
  readonly media = signal<PendingMedia[]>([]);
  readonly posting = signal(false);

  /** Set when the server REJECTED a submit (4xx/5xx from POST /api/v1/statuses —
   *  e.g. a banned/deactivated account, or a homeserver outage). Rendered as an
   *  assertive alert next to the composer so the rejection is ANNOUNCED, never
   *  silently swallowed; cleared on the next submit attempt. The draft is kept
   *  so the user loses nothing. */
  readonly submitError = signal<string | null>(null);

  // ── AI-cloak (poison-before-ingest) ────────────────────────────────────
  /** DEFAULT ON — initialised from the per-user account preference so a
   *  philosophical opt-out user isn't forced to toggle every post. The mode the
   *  server applies (glaze by default) comes from the capability response. */
  readonly poisonImages = signal(this.loadPoisonDefault());
  /** Cloak strength to request when ON (glaze default; nightshade is opt-up). */
  readonly cloakMode = signal<CloakMode>('glaze');
  /** Worker capability queried on open: drives the honest shield state + the
   *  warn-before-post path when the heavy tier is absent. null until resolved. */
  readonly cloakCapability = signal<CloakCapability | null>(null);
  /** Set when an opted-in upload happened with no heavy tier available, so we
   *  surface the "posted without protection" acknowledgement notice. */
  readonly cloakUnavailableNotice = signal(false);

  private readonly draftSig = signal('');

  remaining = computed(() => this.maxChars - this.draftSig().length);

  /** Shorthand the template uses for the labelled shield: 'Glaze' | 'Nightshade'
   *  | 'Off' | 'Unavailable'. Honest: 'Unavailable' the moment the heavy tier is
   *  known absent, even while ON, so the label never overstates. */
  readonly cloakLabel = computed<'Glaze' | 'Nightshade' | 'Off' | 'Unavailable'>(() => {
    if (!this.poisonImages()) return 'Off';
    const cap = this.cloakCapability();
    if (cap && !cap.available) return 'Unavailable';
    return this.cloakMode() === 'nightshade' ? 'Nightshade' : 'Glaze';
  });

  constructor() {
    // Query the worker backend up front so the shield renders an honest state
    // before the first upload, and adopt the server's default mode. Best-effort:
    // a failure leaves the optimistic 'Off'/'glaze' fallback already in place.
    // The optional-chaining guard keeps the composer safe when it is embedded
    // (reply/conversation views) with a partial MastodonService stub.
    void Promise.resolve(this.mastodon.cloakCapability?.())
      .then((cap) => {
        if (!cap) return;
        this.cloakCapability.set(cap);
        if (cap.defaultMode && cap.defaultMode !== 'none') this.cloakMode.set(cap.defaultMode);
      })
      .catch(() => {
        /* ignore — fallback capability already applied */
      });
  }

  // keep the signal in sync for the char counter
  ngDoCheck(): void {
    if (this.draftSig() !== this.draft) this.draftSig.set(this.draft);
    // SOCIAL LOCAL-ONLY: if the user is domain-locked and the bound visibility is
    // still a federated-reach value (e.g. the default 'public', or a value chosen
    // before a cross-tab lock landed), coerce it down to a local-safe one. Done in
    // the check loop so a lock that arrives via the session broadcast is honoured
    // even on an already-open composer — never leaving a federated value selected.
    if (this.domainLocked() && this.isFederatedVisibility(this.visibility)) {
      this.visibility = this.localSafeVisibility;
    }
  }

  /** Whether `v` is a federated-reach visibility (public/unlisted) — the set the
   *  domain-lock disables. private (followers) / direct stay available because
   *  they are already non-public; the homeserver MRF keeps even those local. */
  isFederatedVisibility(v: PostStatusParams['visibility']): boolean {
    return v != null && FEDERATED_VISIBILITIES.includes(v);
  }

  /** Is this visibility option DISABLED in the picker right now? Only the
   *  federated-reach options, and only while domain-locked. */
  isVisibilityLocked(v: NonNullable<PostStatusParams['visibility']>): boolean {
    return this.domainLocked() && this.isFederatedVisibility(v);
  }

  /** The most-open visibility a domain-locked user may still pick: `private`
   *  (followers-only). It never federates outward for a force-local actor, so it
   *  is the honest fallback when a federated value must be coerced down. */
  private readonly localSafeVisibility: NonNullable<PostStatusParams['visibility']> = 'private';

  /** Read the per-user default (ON unless explicitly turned off before). */
  private loadPoisonDefault(): boolean {
    try {
      return localStorage.getItem(POISON_DEFAULT_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  /** Toggle the AI-cloak default and persist the per-user preference. */
  togglePoison(): void {
    this.poisonImages.set(!this.poisonImages());
    try {
      localStorage.setItem(POISON_DEFAULT_KEY, this.poisonImages() ? 'on' : 'off');
    } catch {
      /* ignore quota / private-mode */
    }
    // FUTURE: PUT /bff/user/preferences { 'media.poison.default': … } — see POISON_DEFAULT_KEY.
  }

  canPost(): boolean {
    const hasText = this.draft.trim().length > 0;
    const hasMedia = this.media().some((m) => !m.processing) && this.media().length > 0;
    const hasPoll = this.pollEnabled() && this.pollOptions().filter((o) => o.trim()).length >= 2;
    return (hasText || hasMedia || hasPoll) && this.remaining() >= 0;
  }

  toggleCw(): void {
    this.cwEnabled.set(!this.cwEnabled());
    if (!this.cwEnabled()) this.spoilerText = '';
  }

  togglePoll(): void {
    this.pollEnabled.set(!this.pollEnabled());
    if (!this.pollEnabled()) this.pollOptions.set(['', '']);
  }

  addPollOption(): void {
    if (this.pollOptions().length < 4) this.pollOptions.set([...this.pollOptions(), '']);
  }

  setPollOption(i: number, value: string): void {
    const next = [...this.pollOptions()];
    next[i] = value;
    this.pollOptions.set(next);
  }

  async onFileSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    const isImage = file.type.startsWith('image/');
    const cap = this.cloakCapability();
    // AI-cloak applies to IMAGES only, when ON. If the heavy tier is known
    // absent we forward un-cloaked but surface a "posted without protection"
    // notice — never silently imply safety (warn-before-post, honest copy).
    const cloak = this.poisonImages() && isImage;
    const heavyTierAbsent = cloak && cap !== null && !cap.available;
    if (heavyTierAbsent) this.cloakUnavailableNotice.set(true);

    try {
      if (cloak && !heavyTierAbsent) {
        // Route through the BFF so the bytes are poisoned BEFORE the homeserver
        // ingests/re-encodes/federates them. The media_id is used exactly as a
        // direct upload — downstream submit() is untouched. Media uploads while
        // the user is still typing, so the poison latency overlaps for free.
        const att = await this.mastodon.uploadMediaProtected(file, this.cloakMode());
        const ref = att.cloak?.ref ?? null;
        const pending: PendingMedia = {
          id: att.id,
          preview: att.preview_url,
          description: '',
          processing: att.url === null,
          filename: file.name,
          protection: att.cloak?.status ?? 'pending',
          cloakRef: ref,
          cloakMode: att.cloak?.mode ?? this.cloakMode(),
        };
        this.media.set([...this.media(), pending]);
        if (pending.processing) this.pollMediaReady(att);
        // Poll the poison decision so the badge flips pending → protected/degraded.
        if (ref && pending.protection === 'pending') this.pollCloakStatus(att.id, ref);
      } else {
        // Opt-out, non-image, or no heavy tier → forward straight to the
        // homeserver exactly as before. The badge reads 'off'/'unavailable'.
        const att = await this.mastodon.uploadMedia(file);
        const pending: PendingMedia = {
          id: att.id,
          preview: att.preview_url,
          description: '',
          processing: att.url === null,
          filename: file.name,
          protection: heavyTierAbsent ? 'unavailable' : 'off',
          cloakRef: null,
          cloakMode: 'none',
        };
        this.media.set([...this.media(), pending]);
        if (pending.processing) this.pollMediaReady(att);
      }
    } catch {
      // upload failed — ignore (a real UI would surface an error)
    }
  }

  /** ESCAPE HATCH — "post now without protection": stop waiting on the
   *  (slow) round-trip survival check and treat the attachment as un-cloaked so
   *  the user can post immediately. Honest: it flips the badge to the true
   *  current state ('skipped') rather than pretending it is protected. */
  postWithoutProtection(id: string): void {
    this.media.set(
      this.media().map((m) =>
        m.id === id && (m.protection === 'pending') ? { ...m, protection: 'skipped', cloakRef: null } : m,
      ),
    );
  }

  /** Poll the BFF poison decision until the round-trip survival check resolves,
   *  flipping the per-attachment badge. Stops early if the user hit the escape
   *  hatch (cloakRef cleared) or removed the attachment. */
  private async pollCloakStatus(id: string, ref: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const current = this.media().find((m) => m.id === id);
      if (!current || current.cloakRef !== ref) return; // removed or escape-hatched
      try {
        const res = await this.mastodon.cloakStatus(ref);
        if (res.status !== 'pending') {
          this.media.set(
            this.media().map((m) =>
              m.id === id ? { ...m, protection: res.status, cloakMode: res.mode } : m,
            ),
          );
          return;
        }
      } catch {
        return;
      }
    }
  }

  /** Poll getMedia until url is populated (200) instead of processing (206). */
  private async pollMediaReady(att: MediaAttachment): Promise<void> {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const fresh = await this.mastodon.getMedia(att.id);
        if (fresh.url !== null) {
          this.media.set(
            this.media().map((m) => (m.id === att.id ? { ...m, processing: false, preview: fresh.preview_url } : m)),
          );
          return;
        }
      } catch {
        return;
      }
    }
  }

  removeMedia(id: string): void {
    this.media.set(this.media().filter((m) => m.id !== id));
  }

  /** Honest per-attachment badge text. Never says "protected" for a degraded /
   *  skipped / unavailable outcome — "AI-cloak applied" is the strongest claim,
   *  and only after the server proved the perturbation survived. */
  badgeText(m: PendingMedia): string {
    const mode = m.cloakMode === 'nightshade' ? 'Nightshade' : 'Glaze';
    switch (m.protection) {
      case 'pending':
        return `Applying AI-cloak (${mode})…`;
      case 'protected':
        return `AI-cloak applied (${mode})`;
      case 'degraded':
        return 'AI-cloak weakened — washed out by re-encode';
      case 'failed':
        return 'AI-cloak failed';
      case 'skipped':
        return 'Posted without AI-cloak';
      case 'unavailable':
        return 'AI-cloak unavailable on this server';
      case 'off':
      default:
        return 'No AI-cloak';
    }
  }

  /** Whether the attachment is still being cloaked (drives the escape hatch). */
  isCloaking(m: PendingMedia): boolean {
    return m.protection === 'pending';
  }

  async submit(): Promise<void> {
    if (!this.canPost() || this.posting()) return;
    this.posting.set(true);

    // Defence-in-depth: a domain-locked user must never SUBMIT a federated-reach
    // visibility, even if the bound value was somehow set past the disabled UI.
    // The homeserver MRF forces local delivery regardless, but we keep the
    // submitted intent honest rather than sending 'public' that won't federate.
    const visibility =
      this.domainLocked() && this.isFederatedVisibility(this.visibility)
        ? this.localSafeVisibility
        : this.visibility;

    const params: PostStatusParams = {
      status: this.draft.trim(),
      visibility,
    };
    if (this.inReplyToId) params.in_reply_to_id = this.inReplyToId;
    if (this.cwEnabled() && this.spoilerText.trim()) params.spoiler_text = this.spoilerText.trim();
    const mediaIds = this.media().map((m) => m.id);
    if (mediaIds.length) params.media_ids = mediaIds;
    if (this.pollEnabled()) {
      const options = this.pollOptions()
        .map((o) => o.trim())
        .filter(Boolean);
      if (options.length >= 2) {
        params.poll = { options, expires_in: this.pollExpiresIn, multiple: this.pollMultiple };
      }
    }

    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.submitError.set(null);
    try {
      const created = await this.mastodon.postStatus(params, idempotencyKey);
      this.posted.emit(created);
      this.reset();
    } catch {
      // The server REJECTED the post (e.g. the account was banned/deactivated by
      // a moderator, or the homeserver errored). Announce it honestly — never a
      // silent no-op that looks like success — and keep the draft intact.
      this.submitError.set(
        'Your post was rejected by the server. Your account may be restricted or banned — nothing was posted.',
      );
    } finally {
      this.posting.set(false);
    }
  }

  private reset(): void {
    this.draft = '';
    this.draftSig.set('');
    this.spoilerText = '';
    this.cwEnabled.set(false);
    this.pollEnabled.set(false);
    this.pollOptions.set(['', '']);
    this.media.set([]);
    this.cloakUnavailableNotice.set(false);
  }
}
