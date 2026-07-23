import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Account, Conversation, MastodonService, Status } from '../mastodon.service';
import { AppearancePreferences, PreferencesService } from '../preferences.service';
import { MAX_VN_PROPS, SceneService, VN_DEFAULT_SCENE_ID } from './scene.service';
import { VnScenePickerComponent } from './vn-scene-picker.component';
import { ComposeBoxComponent } from '../compose-box.component';
import { accessibleName } from '../accessible-name';
import { sanitizeContentHtml } from '../html-sanitize';

/** A resolved on-stage prop (manifest entry → shipped asset URL). */
interface StageProp {
  id: string;
  name: string;
  url: string;
}

/** DIALOGUE LENGTH CLAMP: a federated message longer than this (plain-text
 *  characters) renders truncated with a "Show full message" expander instead of
 *  filling the screen with one dialogue box. 1000 chars comfortably covers the
 *  default Mastodon 500-char post limit AND the raised limits (1–5k) common on
 *  friend instances — a normal chat line is never clamped. */
export const VN_DIALOGUE_CLAMP_CHARS = 1000;

/** RENDER CAP on participant sprite cards. A busy group DM can carry dozens of
 *  participants; more than 8 sprite cards cannot fit a 16:9 stage legibly
 *  anyway, so the stage keeps the first 8 (always including the CURRENT
 *  speaker, swapped in if needed) rather than shrinking everyone to confetti.
 *  The dialogue box still names every message's author, so no content is lost. */
const MAX_VN_SPRITES = 8;

/**
 * Visual-novel presentation of ONE direct-message conversation: a shipped
 * flat-vector scene background + prop layer (SceneService — local assets only,
 * never federated bytes), participant "sprites" (large framed account avatars
 * with name plates; the CURRENT message's sender is lit/centred-forward, the
 * others dimmed) and a classic VN dialogue box that walks the thread one
 * message at a time with Prev / Next / Latest navigation.
 *
 * The thread is fetched the way the app already can: the conversation's
 * `last_status` plus its ancestors/descendants via
 * MastodonService.getContext() (GET /api/v1/statuses/{id}/context — fail-soft
 * to an empty context, so a proxy hiccup degrades to a one-message stage, not
 * a broken view).
 *
 * SECURITY: message bodies are federated HTML and rendered EXACTLY the way
 * toot-card renders them — through sanitizeContentHtml() (DOMPurify
 * allow-list) bound to [innerHTML] so Angular's binding sanitizer still runs
 * as the second gate. Nothing beyond that is ever innerHTML'd.
 *
 * The dialogue box carries the `.vn-dialog` class — the ONLY selector contract
 * with the preference SCSS in styles.scss (data-mastodon-chat-vnskin skins,
 * high-contrast override) — so the user's chosen skin/theme applies here
 * automatically. Scene + props are per-user preferences (chatVnScene /
 * chatVnProps) read live from PreferencesService; the embedded picker writes
 * them through the same service.
 */
@Component({
  selector: 'hug-mastodon-vn-chat',
  standalone: true,
  imports: [CommonModule, VnScenePickerComponent, ComposeBoxComponent],
  templateUrl: './vn-chat-view.component.html',
  styleUrl: './vn-chat-view.component.scss',
})
export class VnChatViewComponent implements OnDestroy {
  private readonly mastodon = inject(MastodonService);
  private readonly prefsSvc = inject(PreferencesService);
  private readonly scenesSvc = inject(SceneService);

  /** Per-instance id prefix so help-text ids stay unique with several VN views
   *  open at once (matches the compose-box/toot-card uid convention). */
  private static seq = 0;
  private readonly uid = `vn-chat-${VnChatViewComponent.seq++}`;
  readonly ids = {
    sceneHelp: `${this.uid}-scene-help`,
    navHelp: `${this.uid}-nav-help`,
  };

  private readonly _conversation = signal<Conversation | null>(null);
  /** The conversation to present. Setting it (re)loads the thread. */
  @Input({ required: true }) set conversation(value: Conversation) {
    this._conversation.set(value);
    void this.loadThread(value);
  }

  /** Re-emits the compose box's created reply so the host column can refresh. */
  @Output() readonly posted = new EventEmitter<Status>();

  /** The thread in chronological order (ancestors → last_status → descendants). */
  readonly thread = signal<Status[]>([]);
  /** Index of the CURRENT message the dialogue box shows. */
  readonly index = signal(0);
  readonly loading = signal(false);
  readonly pickerOpen = signal(false);

  /** Resolved background asset URL (null = plain stage, e.g. manifest missing). */
  readonly sceneUrl = signal<string | null>(null);
  /** Resolved enabled on-stage props, in manifest order. */
  readonly stageProps = signal<StageProp[]>([]);

  readonly current = computed<Status | null>(() => this.thread()[this.index()] ?? null);
  readonly speakerId = computed<string | null>(() => this.current()?.account.id ?? null);
  readonly hasPrev = computed(() => this.index() > 0);
  readonly hasNext = computed(() => this.index() < this.thread().length - 1);

  /** Whether the CURRENT (long) message is expanded past the dialogue clamp.
   *  Reset on every navigation — each message starts clamped again. */
  readonly dialogExpanded = signal(false);

  /** The current message's body, sanitized ONCE per message (DOMPurify
   *  allow-list — same gate as toot-card; Angular's binding sanitizer still
   *  runs on top when this reaches [innerHTML]). */
  readonly currentHtml = computed<string>(() => {
    const msg = this.current();
    return msg ? sanitizeContentHtml(msg.content) : '';
  });

  /** Plain-text length of the current message (measured on the SANITIZED
   *  markup, so a tag-heavy body can't dodge the clamp). */
  private readonly currentTextLength = computed<number>(() => this.textOf(this.currentHtml()).length);

  /** Does the current message exceed {@link VN_DIALOGUE_CLAMP_CHARS}? Drives
   *  the "Show full message" expander. */
  readonly isLongMessage = computed<boolean>(() => this.currentTextLength() > VN_DIALOGUE_CLAMP_CHARS);

  /** The truncated PLAIN-TEXT rendering of an over-long, un-expanded message
   *  (interpolated, never [innerHTML] — a clamped cut could split an HTML tag).
   *  Null when the message is short enough or expanded (full HTML renders). */
  readonly clampedText = computed<string | null>(() => {
    if (!this.isLongMessage() || this.dialogExpanded()) return null;
    return `${this.textOf(this.currentHtml()).slice(0, VN_DIALOGUE_CLAMP_CHARS)}…`;
  });

  /** The newest status — the reply seam's in_reply_to target. */
  readonly latestStatus = computed<Status | null>(() => {
    const t = this.thread();
    return t.length ? t[t.length - 1] : this._conversation()?.last_status ?? null;
  });

  /** Every participant to render as a sprite: the conversation's accounts plus
   *  any thread author not listed there (e.g. the caller's own account).
   *  Render-capped at {@link MAX_VN_SPRITES}, always keeping the current
   *  speaker on stage. */
  readonly sprites = computed<Account[]>(() => {
    const seen = new Map<string, Account>();
    for (const a of this._conversation()?.accounts ?? []) seen.set(a.id, a);
    for (const s of this.thread()) if (!seen.has(s.account.id)) seen.set(s.account.id, s.account);
    const all = [...seen.values()];
    if (all.length <= MAX_VN_SPRITES) return all;
    const kept = all.slice(0, MAX_VN_SPRITES);
    const speakerId = this.current()?.account.id ?? null;
    if (speakerId && !kept.some((a) => a.id === speakerId)) {
      const speaker = seen.get(speakerId);
      if (speaker) kept[kept.length - 1] = speaker; // the speaker always makes the stage
    }
    return kept;
  });

  /** Typewriter reveal is skipped whenever the user prefers reduced motion —
   *  either the saved/OS-seeded preference (PreferencesService seeds it from
   *  the OS at boot) or a live OS-level media query match. */
  readonly reducedMotion = computed<boolean>(() => {
    if (this.prefsSvc.prefs().reducedMotion) return true;
    try {
      return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });

  /** Only re-resolve stage assets when the scene/props choice actually changed. */
  private lastStageKey: string | null = null;
  /** Monotonic tokens so a stale async resolve/load can never clobber a newer one. */
  private stageToken = 0;
  private threadToken = 0;

  private readonly prefsSub: Subscription;

  constructor() {
    // Datastore pattern: follow the live preference stream so a scene/prop
    // choice made in the embedded picker (or another tab via the storage sync)
    // restyles the stage immediately.
    this.prefsSub = this.prefsSvc.prefs$.subscribe((p) => this.onPrefs(p));
  }

  ngOnDestroy(): void {
    this.prefsSub.unsubscribe();
  }

  private onPrefs(p: AppearancePreferences): void {
    const key = `${p.chatVnScene}|${p.chatVnProps}`;
    if (key === this.lastStageKey) return;
    this.lastStageKey = key;
    void this.resolveStage(p.chatVnScene, p.chatVnProps);
  }

  /** Resolve the chosen scene + enabled props to shipped asset URLs. Fail-soft:
   *  an unknown scene id (stale saved pref) falls back to the default scene,
   *  and a missing manifest leaves a plain stage rather than broken images. */
  private async resolveStage(sceneId: string, propsCsv: string): Promise<void> {
    const token = ++this.stageToken;
    // Scene id VALIDATED against the shipped manifest (sceneUrl returns null
    // for an unknown/stale id) → fall back to the default scene, never a
    // broken image from a corrupt/hostile stored preference.
    const url =
      (await this.scenesSvc.sceneUrl(sceneId)) ?? (await this.scenesSvc.sceneUrl(VN_DEFAULT_SCENE_ID));
    // PARSE cap (MAX_VN_PROPS): a corrupt/hostile stored pref can list any
    // number of ids — only the first 16 are ever considered.
    const wanted = propsCsv.split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_VN_PROPS);
    const allProps = await this.scenesSvc.props();
    if (token !== this.stageToken) return; // a newer choice resolved meanwhile
    this.sceneUrl.set(url);
    this.stageProps.set(
      allProps
        .filter((p) => wanted.includes(p.id))
        .map((p) => ({ id: p.id, name: p.displayName, url: this.scenesSvc.assetUrl(p.file) }))
        // RENDER cap (defence-in-depth with the parse cap above): the stage
        // never draws more than MAX_VN_PROPS prop images.
        .slice(0, MAX_VN_PROPS),
    );
  }

  /** Fetch last_status + its context and assemble the chronological thread,
   *  opening on the LATEST message (a chat opens at the newest line). */
  private async loadThread(c: Conversation | null): Promise<void> {
    const token = ++this.threadToken;
    const last = c?.last_status ?? null;
    if (!last) {
      this.thread.set([]);
      this.index.set(0);
      return;
    }
    this.loading.set(true);
    try {
      const ctx = await this.mastodon.getContext(last.id);
      if (token !== this.threadToken) return; // a newer conversation loaded meanwhile
      const seen = new Set<string>();
      const all = [...ctx.ancestors, last, ...ctx.descendants]
        .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      this.thread.set(all);
      this.setIndex(all.length - 1);
    } finally {
      if (token === this.threadToken) this.loading.set(false);
    }
  }

  // ── navigation ───────────────────────────────────────────────────────────

  /** The ONLY index write path: clamps to [0, thread.length-1] so no caller
   *  (nav button, thread reload, reply append) can ever park the dialogue on
   *  an out-of-range message, and resets the long-message expander — each
   *  message starts clamped again. */
  private setIndex(i: number): void {
    const len = this.thread().length;
    this.index.set(len ? Math.min(Math.max(0, i), len - 1) : 0);
    this.dialogExpanded.set(false);
  }

  prev(): void {
    if (this.hasPrev()) this.setIndex(this.index() - 1);
  }

  next(): void {
    if (this.hasNext()) this.setIndex(this.index() + 1);
  }

  latest(): void {
    const len = this.thread().length;
    if (len) this.setIndex(len - 1);
  }

  toggleExpanded(): void {
    this.dialogExpanded.set(!this.dialogExpanded());
  }

  togglePicker(): void {
    this.pickerOpen.set(!this.pickerOpen());
  }

  /** Accessible name for a nav control, carrying the position it moves to
   *  (e.g. "Previous message, go to message 3 of 12"). */
  navLabel(kind: 'prev' | 'next' | 'latest'): string {
    const len = this.thread().length;
    switch (kind) {
      case 'prev':
        return `Previous message, go to message ${Math.max(1, this.index())} of ${len}`;
      case 'next':
        return `Next message, go to message ${Math.min(len, this.index() + 2)} of ${len}`;
      case 'latest':
      default:
        return `Jump to latest message, message ${len} of ${len}`;
    }
  }

  /** A reply posted from the seam: append it locally (no refetch needed), jump
   *  the dialogue to it, and re-emit so the host column can reload its list. */
  onReplied(created: Status): void {
    if (!this.thread().some((s) => s.id === created.id)) {
      this.thread.set([...this.thread(), created]);
    }
    this.latest();
    this.posted.emit(created);
  }

  // ── rendering helpers (mirroring toot-card's conventions) ────────────────

  /** Federated HTML → DOMPurify allow-list string for [innerHTML]; Angular's
   *  binding sanitizer still runs on top (defence-in-depth, same as toot-card). */
  safeContent(html: string): string {
    return sanitizeContentHtml(html);
  }

  /** RENDER CAP on the on-stage polaroid cards. Mastodon caps a status at 4
   *  attachments; a non-conforming server can't push more than 4 cards onto
   *  the stage either. */
  polaroids(msg: Status): Status['media_attachments'] {
    return msg.media_attachments.slice(0, 4);
  }

  /** Plain text of already-sanitized markup (detached parse — nothing executes
   *  or loads; the input has passed the DOMPurify allow-list already). */
  private textOf(html: string): string {
    if (typeof DOMParser === 'undefined') return html;
    try {
      return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
    } catch {
      return html;
    }
  }

  /** Screen-reader name for an account (ASCII screen_reader_name when present). */
  accountName(a: Account): string {
    return accessibleName(a.display_name || a.username, a.screen_reader_name);
  }

  formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }

  trackId = (_: number, s: Status): string => s.id;
}
