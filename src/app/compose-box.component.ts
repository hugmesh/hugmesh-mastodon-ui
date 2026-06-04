import { Component, EventEmitter, Input, Output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MastodonService, MediaAttachment, PostStatusParams, Status } from './mastodon.service';

interface PendingMedia {
  id: string;
  preview: string | null;
  description: string;
  processing: boolean;
  filename: string;
}

/** Mastodon Compose / ComposeForm: text + CW + visibility + media + poll.
 *  Reused as the inline reply composer (in_reply_to_id). */
@Component({
  selector: 'snap-mastodon-compose-box',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <form class="compose" (submit)="$event.preventDefault(); submit()">
      <div class="compose-cw-row" *ngIf="cwEnabled()">
        <input
          type="text"
          data-testid="compose-spoiler-input"
          [(ngModel)]="spoilerText"
          name="spoiler"
          placeholder="Content warning"
        />
      </div>

      <textarea
        data-testid="mastodon-input"
        [(ngModel)]="draft"
        name="draft"
        [placeholder]="placeholder"
        rows="3"
      ></textarea>

      <div class="compose-media" *ngIf="media().length">
        <div class="compose-media-item" data-testid="compose-media-item" *ngFor="let m of media()">
          <img *ngIf="m.preview" [src]="m.preview" alt="" width="60" height="60" />
          <span *ngIf="m.processing" class="processing">processing…</span>
          <input
            type="text"
            [(ngModel)]="m.description"
            [ngModelOptions]="{ standalone: true }"
            placeholder="Describe for the visually impaired"
          />
          <button type="button" (click)="removeMedia(m.id)">✕</button>
        </div>
      </div>

      <div class="compose-poll" *ngIf="pollEnabled()">
        <div *ngFor="let _ of pollOptions(); let i = index">
          <input
            type="text"
            data-testid="compose-poll-option"
            [ngModel]="pollOptions()[i]"
            (ngModelChange)="setPollOption(i, $event)"
            [ngModelOptions]="{ standalone: true }"
            placeholder="Choice {{ i + 1 }}"
          />
        </div>
        <button type="button" (click)="addPollOption()" [disabled]="pollOptions().length >= 4">
          + option
        </button>
        <label>
          <input type="checkbox" [(ngModel)]="pollMultiple" name="pollMultiple" /> Allow multiple
        </label>
        <select [(ngModel)]="pollExpiresIn" name="pollExpires">
          <option [ngValue]="300">5 minutes</option>
          <option [ngValue]="3600">1 hour</option>
          <option [ngValue]="86400">1 day</option>
          <option [ngValue]="604800">1 week</option>
        </select>
      </div>

      <div class="compose-controls">
        <button type="button" data-testid="compose-cw-toggle" (click)="toggleCw()">CW</button>
        <select data-testid="compose-visibility" [(ngModel)]="visibility" name="visibility">
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Followers</option>
          <option value="direct">Direct</option>
        </select>
        <label class="attach-btn" data-testid="compose-media-attach">
          📎
          <input type="file" hidden (change)="onFileSelected($event)" accept="image/*,video/*,audio/*" />
        </label>
        <button type="button" data-testid="compose-poll-toggle" (click)="togglePoll()">📊</button>
        <span class="compose-char-count" data-testid="compose-char-count">{{ remaining() }}</span>
        <button
          type="submit"
          data-testid="mastodon-post"
          [disabled]="!canPost() || posting()"
        >
          {{ inReplyToId ? 'Reply' : 'Toot' }}
        </button>
      </div>
    </form>
  `,
})
export class ComposeBoxComponent {
  private readonly mastodon = inject(MastodonService);

  @Input() inReplyToId: string | null = null;
  @Input() placeholder = "What's on your mind?";
  @Input() set defaultVisibility(v: PostStatusParams['visibility']) {
    if (v) this.visibility = v;
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

  private readonly draftSig = signal('');

  remaining = computed(() => this.maxChars - this.draftSig().length);

  // keep the signal in sync for the char counter
  ngDoCheck(): void {
    if (this.draftSig() !== this.draft) this.draftSig.set(this.draft);
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
    try {
      const att = await this.mastodon.uploadMedia(file);
      const pending: PendingMedia = {
        id: att.id,
        preview: att.preview_url,
        description: '',
        processing: att.url === null,
        filename: file.name,
      };
      this.media.set([...this.media(), pending]);
      if (pending.processing) this.pollMediaReady(att);
    } catch {
      // upload failed — ignore (a real UI would surface an error)
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

  async submit(): Promise<void> {
    if (!this.canPost() || this.posting()) return;
    this.posting.set(true);

    const params: PostStatusParams = {
      status: this.draft.trim(),
      visibility: this.visibility,
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
    try {
      const created = await this.mastodon.postStatus(params, idempotencyKey);
      this.posted.emit(created);
      this.reset();
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
  }
}
