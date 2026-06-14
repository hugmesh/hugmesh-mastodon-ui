import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MastodonService, Status, Poll, Account } from './mastodon.service';
import { PollComponent } from './poll.component';
import { RoleActionsMenuComponent } from './role-actions-menu.component';
import { accessibleName } from './accessible-name';

/** Mastodon Status component + StatusActionBar: avatar, content (sanitized HTML),
 *  CW collapse, media gallery, inline poll, and an action bar with optimistic
 *  favourite / boost / bookmark toggles. */
@Component({
  selector: 'snap-mastodon-toot-card',
  standalone: true,
  imports: [CommonModule, RouterLink, PollComponent, RoleActionsMenuComponent],
  templateUrl: './toot-card.component.html',
  styleUrl: './toot-card.component.scss',
})
export class TootCardComponent {
  private readonly mastodon = inject(MastodonService);

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

  /** Per-instance id prefix so the action-bar help element has a UNIQUE id even
   *  when a long timeline renders many toot cards at once — each action button's
   *  aria-describedby must resolve to ITS OWN card's help, not the first one. */
  private static seq = 0;
  private readonly uid = `toot-${TootCardComponent.seq++}`;
  readonly ids = {
    actionsHelp: `${this.uid}-actions-help`,
  };

  /** The status to render: if this is a boost wrapper, render the inner reblog. */
  display(): Status | null {
    const s = this._status();
    return s?.reblog ? s.reblog : s;
  }

  isBoost(): boolean {
    return !!this._status()?.reblog;
  }

  /** True when the attachment originates on another instance (we did not upload
   *  it, so AI-cloak is N/A — never implied as ON). Honest counterpart to the
   *  composer's cloak badge: a boost of a remote post re-serves bytes we don't
   *  own, so the shield reads "N/A — remote media", not a protection claim. */
  isRemoteMedia(m: { remote_url: string | null }): boolean {
    return !!m.remote_url;
  }

  booster() {
    return this._status()?.account ?? null;
  }

  /** The name a screen reader should announce for an account: its ASCII
   *  screenReaderName when the homeserver/BFF supplied one, else the (possibly
   *  non-ASCII) display_name, else the @username. Used for EVERY aria-label/alt
   *  that embeds a user name so a non-ASCII display name is spoken via its ASCII
   *  name — the visible text still shows the display_name verbatim. */
  accountName(a: Account): string {
    return accessibleName(a.display_name || a.username, a.screen_reader_name);
  }

  /** Toot bodies are remote/federated HTML and MUST NOT be trusted. We return
   *  the raw string so Angular's [innerHTML] binding runs its built-in
   *  sanitizer, which strips <script>/<style>/on* handlers/javascript: URLs and
   *  keeps only safe formatting markup (a, p, br, span, em, strong, lists,
   *  blockquote, code). Never bypassSecurityTrustHtml here — that disables the
   *  sanitizer and re-opens stored/DOM XSS (A03 / CWE-79). */
  safeContent(html: string): string {
    return html;
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
