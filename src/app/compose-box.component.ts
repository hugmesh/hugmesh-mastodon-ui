import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal,
  computed,
} from '@angular/core';
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
import {
  MAX_RECORDED_UPLOAD_BYTES,
  MAX_RECORDING_SECONDS,
  MediaRecorderService,
  RecorderError,
  RecorderKind,
} from './media-recorder.service';
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

/** A finished voice/video recording awaiting the user's Attach/Discard call.
 *  `url` is an object URL for the local playback preview — revoked whenever the
 *  take leaves this state (attach, discard, destroy), never leaked. */
interface PendingTake {
  file: File;
  url: string;
  kind: RecorderKind;
}

/** localStorage key for the per-user AI-cloak default (default ON). Honestly a
 *  per-browser preference for this PR; the durable account-level value lives in
 *  the user-bff-api `user_preference` row keyed `media.poison.default` (the BFF
 *  capability response also carries the server defaultMode). The drop-in is to
 *  hydrate this from GET /bff/user/media/capability.defaultMode on init — which
 *  the composer already calls — and to PUT the toggle change to the BFF. */
export const POISON_DEFAULT_KEY = 'hug.mastodon.poison.default.v1';

/** Mastodon Compose / ComposeForm: text + CW + visibility + media + poll.
 *  Reused as the inline reply composer (in_reply_to_id). */
@Component({
  selector: 'hug-mastodon-compose-box',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './compose-box.component.html',
  styleUrl: './compose-box.component.scss',
  // Component-provided ON PURPOSE: each composer (main + every inline DM reply)
  // owns its OWN recorder, so recording in one never bleeds into another, and
  // Angular tears the mic/camera down with the component (service ngOnDestroy).
  providers: [MediaRecorderService],
})
export class ComposeBoxComponent implements OnDestroy {
  private readonly mastodon = inject(MastodonService);
  private readonly sessionSvc = inject(SessionService);
  /** Voice/video message recorder (see providers note above). Public: the
   *  template reads its state/kind/elapsed/error signals directly. */
  readonly recorder = inject(MediaRecorderService);

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
    // Honour a caller-supplied default (the thread reply composer passes the
    // PARENT's visibility, which could be 'public'). No coercion needed here:
    // `visibility` derives it, so a domain-locked session can never end up
    // showing a federated reach whichever order the input and the lock arrive in.
    if (v) this.chosenVisibility.set(v);
  }
  @Output() readonly posted = new EventEmitter<Status>();

  private readonly maxChars = 500;

  draft = '';
  spoilerText = '';
  pollMultiple = false;
  pollExpiresIn = 86400;

  /** The reach the USER picked (or a caller seeded via `defaultVisibility`).
   *  Raw — never read directly by the template; see {@link visibility}. */
  private readonly chosenVisibility = signal<NonNullable<PostStatusParams['visibility']>>('public');

  /** The reach actually offered and posted: the user's choice, coerced down to
   *  a local-safe one while the session is domain-locked.
   *
   *  DERIVED (computed) rather than a field mutated from the check loop: the
   *  lock is a signal, so a domain-lock that lands MID-SESSION via the
   *  `hug-session-change` broadcast recomputes this immediately and the bound
   *  <select> re-renders without a reload — no ngDoCheck poll, and no window in
   *  which the picker still shows a federated reach the server will refuse. */
  readonly visibility = computed<NonNullable<PostStatusParams['visibility']>>(() =>
    this.localSafe(this.chosenVisibility()),
  );

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

  // ── Voice & video messages (recorder) ──────────────────────────────────
  /** Feature-detected ONCE at construction: when the browser has no
   *  MediaRecorder/getUserMedia the mic/camera buttons are hidden entirely
   *  (never a dead control), matching the fail-soft house style. */
  readonly recorderSupported = this.recorder.isSupported();
  /** A finished take awaiting Attach/Discard (local object-URL preview). */
  readonly pendingTake = signal<PendingTake | null>(null);
  /** Honest refusal shown when a finished take can't be attached (today: the
   *  {@link MAX_RECORDED_UPLOAD_BYTES} size cap). Polite aria-live in the
   *  template; cleared on discard / a new recording. */
  readonly takeError = signal<string | null>(null);
  /** True while a recording is in flight OR a take awaits a decision — gates
   *  the record buttons so there is only ever one take in progress. */
  readonly recorderBusy = computed(() => this.recorder.state() !== 'idle' || this.pendingTake() !== null);
  readonly isRecording = computed(() => this.recorder.state() === 'recording');
  /** mm:ss elapsed clock for the recording indicator. DISPLAY BOUNDED to
   *  [0, MAX_RECORDING_SECONDS]: the service auto-stops at the cap, but even if
   *  a stray tick raced past it the clock renders at most "05:00" — never an
   *  ever-growing (layout-breaking) number. */
  readonly recorderClock = computed(() => {
    const total = Math.min(Math.max(0, this.recorder.elapsedSeconds()), MAX_RECORDING_SECONDS);
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  });

  /** Live camera self-view while recording video: `srcObject` cannot be set
   *  from a template binding, so the ViewChild setter (which fires when the
   *  *ngIf materialises the element) wires the stream imperatively. Muted in
   *  the template — the user must never hear their own mic looped back. */
  @ViewChild('recorderLive') set recorderLive(ref: ElementRef<HTMLVideoElement> | undefined) {
    if (ref?.nativeElement) ref.nativeElement.srcObject = this.recorder.liveStream;
  }

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
    // (The domain-lock visibility coercion used to live here. It is now DERIVED
    // in the `visibility` computed above, so a lock arriving mid-session via the
    // session broadcast updates the rendered <select> through the signal graph
    // instead of relying on a check-loop pass.)
    // VOICE/VIDEO TAKE ADOPTION: the service publishes a finished take on its
    // `take` signal from BOTH stop paths (the Stop button and the 300s auto-cap
    // firing inside the service). Adopting it here in the check loop — the same
    // pattern as the draftSig sync above — means the auto-cap take surfaces on
    // the very next change-detection pass without any extra subscription.
    const take = this.recorder.take();
    if (take && !this.pendingTake()) this.adoptTake(take);
  }

  /** Move a finished take out of the service into the local preview state
   *  (object URL for the audio/video player) and free the recorder. */
  private adoptTake(file: File): void {
    this.recorder.clearTake();
    const kind: RecorderKind = file.type.startsWith('video/') ? 'video' : 'audio';
    let url = '';
    try {
      url = URL.createObjectURL(file);
    } catch {
      /* preview-less take is still attachable */
    }
    this.pendingTake.set({ file, url, kind });
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

  /** The single coercion rule, shared by the rendered `visibility` computed and
   *  by submit(): while domain-locked, a federated reach becomes the local-safe
   *  one; anything already non-public is left alone. */
  private localSafe(
    v: NonNullable<PostStatusParams['visibility']>,
  ): NonNullable<PostStatusParams['visibility']> {
    return this.domainLocked() && this.isFederatedVisibility(v) ? this.localSafeVisibility : v;
  }

  /** The picker's (ngModelChange) sink — records the RAW user choice; what the
   *  select shows is the derived {@link visibility}. */
  setVisibility(v: NonNullable<PostStatusParams['visibility']>): void {
    this.chosenVisibility.set(v);
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
    await this.ingestFile(file);
  }

  /** SHARED attachment ingest — the file-picker path and the recorded
   *  voice/video take path both land here, so a recorded message follows the
   *  EXACT same rules as a picked file: images go through the AI-cloak BFF
   *  route when ON, audio/video goes straight to uploadMedia (the cloak is
   *  image-only), and the pending-media list/limits behave identically. */
  private async ingestFile(file: File): Promise<void> {
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

  // ── Voice & video messages (recorder) ──────────────────────────────────

  /** Start a voice (mic) or video (camera+mic) recording. Refusals — no
   *  support, permission denied, device failure — surface via the recorder's
   *  error signal (rendered fail-soft below the controls), never a throw. */
  async startRecording(kind: RecorderKind): Promise<void> {
    if (this.recorderBusy() || this.posting()) return;
    this.takeError.set(null);
    if (kind === 'audio') await this.recorder.startAudio();
    else await this.recorder.startVideo();
  }

  /** Finalise the take. The resulting File arrives via the recorder's `take`
   *  signal and is adopted in ngDoCheck — the same route the 300s auto-cap
   *  uses — so both stop paths share one preview flow. */
  stopRecording(): void {
    void this.recorder.stop();
  }

  /** Abandon the in-flight recording: every track stopped, nothing kept. */
  cancelRecording(): void {
    this.recorder.cancel();
  }

  /** Attach the previewed take: feeds the recorded File through the SAME
   *  ingest path as the file picker (audio/video → uploadMedia; the AI-cloak
   *  route is image-only and never sees it). */
  async attachTake(): Promise<void> {
    const take = this.pendingTake();
    if (!take || this.posting()) return;
    // UPLOAD SIZE GUARD — refuse BEFORE any bytes leave the browser (see
    // MAX_RECORDED_UPLOAD_BYTES for why 64 MiB). Honest + polite (aria-live
    // status in the template): the preview is kept so the user can replay it,
    // and Discard stays available; nothing is uploaded.
    if (take.file.size > MAX_RECORDED_UPLOAD_BYTES) {
      this.takeError.set(
        'This recording is too large to attach (over 64 MiB). Please discard it and record a shorter message.',
      );
      return;
    }
    this.takeError.set(null);
    this.releaseTake();
    await this.ingestFile(take.file);
  }

  /** Throw the previewed take away (nothing was ever uploaded). */
  discardTake(): void {
    this.takeError.set(null);
    this.releaseTake();
  }

  /** Clear the take preview and revoke its object URL (never leaked). */
  private releaseTake(): void {
    const take = this.pendingTake();
    this.pendingTake.set(null);
    if (take?.url) {
      try {
        URL.revokeObjectURL(take.url);
      } catch {
        /* already revoked */
      }
    }
  }

  /** Honest fail-soft copy for the recorder error states. */
  recorderErrorText(err: RecorderError): string {
    switch (err) {
      case 'unsupported':
        return 'Recording is not supported in this browser.';
      case 'permission-denied':
        return 'Microphone/camera access was denied — allow it in your browser settings to record a message.';
      case 'failed':
      default:
        return 'Recording failed — check your microphone/camera and try again.';
    }
  }

  /** The recorder itself is component-provided (Angular tears its tracks down
   *  with us); the object-URL preview is ours to revoke. */
  ngOnDestroy(): void {
    this.releaseTake();
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

  /** Push each attachment's typed alt text to the server (PUT /api/v1/media/:id)
   *  BEFORE the status is posted — Mastodon only accepts a description update
   *  while the attachment is still unattached. Without this the describe-input
   *  was a dead control: submit() sends only media_ids, so a description typed
   *  after upload was silently discarded and no attachment ever got alt text.
   *  Only non-empty descriptions are sent (nothing to save otherwise). A
   *  rejection throws so submit() can announce that the alt text was NOT saved
   *  instead of quietly posting without it. */
  private async saveMediaDescriptions(): Promise<void> {
    for (const m of this.media()) {
      const description = m.description.trim();
      if (!description) continue;
      await this.mastodon.updateMedia(m.id, { description });
    }
  }

  async submit(): Promise<void> {
    if (!this.canPost() || this.posting()) return;
    this.posting.set(true);

    // Defence-in-depth: a domain-locked user must never SUBMIT a federated-reach
    // visibility, even if the RAW choice was set past the disabled UI (e.g. a
    // caller-supplied defaultVisibility, or a lock that landed after the pick).
    // Coerced from the raw signal — not from the already-derived `visibility` —
    // so this stays a genuinely independent second gate. The homeserver MRF
    // forces local delivery regardless; we keep the submitted intent honest
    // rather than sending 'public' that won't federate.
    const visibility = this.localSafe(this.chosenVisibility());

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

    // Alt text FIRST: descriptions must land on the server before the status
    // claims the attachments (Mastodon rejects a description update once the
    // media is attached). A failed save ABORTS the post with an honest alert —
    // never a silent "posted, but the alt text you typed went nowhere".
    try {
      await this.saveMediaDescriptions();
    } catch {
      this.submitError.set(
        'Could not save your image description (alt text) — nothing was posted. Please try again.',
      );
      this.posting.set(false);
      return;
    }

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
