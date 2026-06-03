import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MastodonService, Status, Poll } from './mastodon.service';
import { PollComponent } from './poll.component';

/** Mastodon Status component + StatusActionBar: avatar, content (sanitized HTML),
 *  CW collapse, media gallery, inline poll, and an action bar with optimistic
 *  favourite / boost / bookmark toggles. */
@Component({
  selector: 'snap-mastodon-toot-card',
  standalone: true,
  imports: [CommonModule, RouterLink, PollComponent],
  template: `
    <article class="toot-card" data-testid="toot-card" [class.focused]="focused" *ngIf="display() as s">
      <div class="boost-header" *ngIf="isBoost()">
        <span>🔁 {{ booster()?.display_name || booster()?.username }} boosted</span>
      </div>

      <header class="toot-head">
        <a class="toot-avatar" [routerLink]="['/account', s.account.acct]">
          <img *ngIf="s.account.avatar" [src]="s.account.avatar" alt="" width="40" height="40" />
        </a>
        <div class="toot-author">
          <a class="toot-name" [routerLink]="['/account', s.account.acct]">{{
            s.account.display_name || s.account.username
          }}</a>
          <span class="toot-acct">&#64;{{ s.account.acct }}</span>
        </div>
        <time class="toot-time" [attr.datetime]="s.created_at">{{ relative(s.created_at) }}</time>
      </header>

      <div class="toot-cw" *ngIf="s.spoiler_text">
        <span class="cw-text">{{ s.spoiler_text }}</span>
        <button type="button" data-testid="toot-cw-toggle" (click)="toggleCw()">
          {{ cwOpen() ? 'Show less' : 'Show more' }}
        </button>
      </div>

      <div
        class="toot-content"
        data-testid="toot-content"
        *ngIf="!s.spoiler_text || cwOpen()"
        [innerHTML]="safeContent(s.content)"
        (click)="onContentClick($event)"
      ></div>

      <div class="toot-media" *ngIf="(!s.spoiler_text || cwOpen()) && s.media_attachments.length">
        <ng-container *ngFor="let m of s.media_attachments">
          <img
            *ngIf="m.type === 'image' && m.preview_url"
            [src]="m.preview_url"
            [alt]="m.description || ''"
            [class.sensitive]="s.sensitive && !cwOpen()"
            loading="lazy"
          />
          <video
            *ngIf="(m.type === 'video' || m.type === 'gifv') && m.url"
            [src]="m.url"
            controls
            [muted]="m.type === 'gifv'"
          ></video>
          <audio *ngIf="m.type === 'audio' && m.url" [src]="m.url" controls></audio>
        </ng-container>
      </div>

      <snap-mastodon-poll
        *ngIf="(!s.spoiler_text || cwOpen()) && s.poll"
        [poll]="s.poll"
        (pollChange)="onPollChange($event)"
      ></snap-mastodon-poll>

      <footer class="toot-actions">
        <button type="button" class="act act-reply" data-testid="toot-reply" (click)="reply.emit(s)">
          💬 <span data-testid="toot-replies-count">{{ s.replies_count }}</span>
        </button>
        <button
          type="button"
          class="act act-boost"
          data-testid="toot-boost"
          [class.active]="s.reblogged"
          (click)="toggleBoost(s)"
          [disabled]="busy()"
        >
          🔁 <span data-testid="toot-reblog-count">{{ s.reblogs_count }}</span>
        </button>
        <button
          type="button"
          class="act act-fav"
          data-testid="toot-favourite"
          [class.active]="s.favourited"
          (click)="toggleFavourite(s)"
          [disabled]="busy()"
        >
          ⭐ <span data-testid="toot-favourite-count">{{ s.favourites_count }}</span>
        </button>
        <button
          type="button"
          class="act act-bookmark"
          data-testid="toot-bookmark"
          [class.active]="s.bookmarked"
          (click)="toggleBookmark(s)"
          [disabled]="busy()"
        >
          🔖
        </button>
        <a class="act act-open" [routerLink]="['/status', s.id]">Open</a>
      </footer>
    </article>
  `,
})
export class TootCardComponent {
  private readonly mastodon = inject(MastodonService);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly _status = signal<Status | null>(null);
  @Input({ required: true }) set status(value: Status) {
    this._status.set(value);
    this.cwOpen.set(false);
  }
  @Input() focused = false;

  @Output() readonly reply = new EventEmitter<Status>();
  @Output() readonly changed = new EventEmitter<Status>();
  @Output() readonly hashtagClick = new EventEmitter<string>();

  readonly cwOpen = signal(false);
  readonly busy = signal(false);

  /** The status to render: if this is a boost wrapper, render the inner reblog. */
  display(): Status | null {
    const s = this._status();
    return s?.reblog ? s.reblog : s;
  }

  isBoost(): boolean {
    return !!this._status()?.reblog;
  }

  booster() {
    return this._status()?.account ?? null;
  }

  safeContent(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  relative(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  toggleCw(): void {
    this.cwOpen.set(!this.cwOpen());
  }

  onContentClick(ev: MouseEvent): void {
    const target = ev.target as HTMLElement;
    if (target.tagName === 'A') {
      const text = target.textContent?.trim() ?? '';
      if (text.startsWith('#')) {
        ev.preventDefault();
        this.hashtagClick.emit(text.slice(1));
      }
    }
  }

  onPollChange(poll: Poll): void {
    const s = this.display();
    if (s) this.patch(s, { poll });
  }

  /** Apply a patch to whichever status object we currently hold. */
  private patch(target: Status, fields: Partial<Status>): void {
    const root = this._status();
    if (!root) return;
    if (root.reblog && root.reblog === target) {
      this._status.set({ ...root, reblog: { ...root.reblog, ...fields } });
    } else {
      this._status.set({ ...root, ...fields });
    }
    this.changed.emit(this._status()!);
  }

  async toggleFavourite(s: Status): Promise<void> {
    const was = !!s.favourited;
    this.patch(s, { favourited: !was, favourites_count: s.favourites_count + (was ? -1 : 1) });
    this.busy.set(true);
    try {
      const updated = was ? await this.mastodon.unfavourite(s.id) : await this.mastodon.favourite(s.id);
      this.patch(this.display()!, {
        favourited: updated.favourited,
        favourites_count: updated.favourites_count,
      });
    } catch {
      this.patch(this.display()!, { favourited: was, favourites_count: s.favourites_count });
    } finally {
      this.busy.set(false);
    }
  }

  async toggleBoost(s: Status): Promise<void> {
    const was = !!s.reblogged;
    this.patch(s, { reblogged: !was, reblogs_count: s.reblogs_count + (was ? -1 : 1) });
    this.busy.set(true);
    try {
      const updated = was ? await this.mastodon.unreblog(s.id) : await this.mastodon.reblog(s.id);
      // reblog() returns a wrapper whose .reblog is the original; unreblog returns the original.
      const original = updated.reblog ?? updated;
      this.patch(this.display()!, {
        reblogged: original.reblogged,
        reblogs_count: original.reblogs_count,
      });
    } catch {
      this.patch(this.display()!, { reblogged: was, reblogs_count: s.reblogs_count });
    } finally {
      this.busy.set(false);
    }
  }

  async toggleBookmark(s: Status): Promise<void> {
    const was = !!s.bookmarked;
    this.patch(s, { bookmarked: !was });
    this.busy.set(true);
    try {
      const updated = was ? await this.mastodon.unbookmark(s.id) : await this.mastodon.bookmark(s.id);
      this.patch(this.display()!, { bookmarked: updated.bookmarked });
    } catch {
      this.patch(this.display()!, { bookmarked: was });
    } finally {
      this.busy.set(false);
    }
  }
}
