import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MastodonService, Account, Relationship, Status } from './mastodon.service';
import { TootCardComponent } from './toot-card.component';

type ProfileTab = 'posts' | 'replies' | 'media';

/** Mastodon Account header + AccountTimeline: header/avatar/bio/fields, stats,
 *  follow button (driven by Relationship, hidden on own profile), and tabbed
 *  Posts / Posts & Replies / Media timelines. */
@Component({
  selector: 'snap-mastodon-account-profile',
  standalone: true,
  imports: [CommonModule, TootCardComponent],
  templateUrl: './account-profile.component.html',
  styleUrl: './account-profile.component.scss',
})
export class AccountProfileComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  readonly account = signal<Account | null>(null);
  readonly relationship = signal<Relationship | null>(null);
  readonly statuses = signal<Status[]>([]);
  readonly tab = signal<ProfileTab>('posts');
  readonly loading = signal(false);
  readonly followBusy = signal(false);
  readonly exhausted = signal(false);

  private selfId: string | null = null;

  trackId = (_: number, s: Status): string => s.id;

  async ngOnInit(): Promise<void> {
    this.route.paramMap.subscribe(async (p) => {
      const acct = p.get('acct');
      if (acct) await this.load(acct);
    });
  }

  isSelf(): boolean {
    const a = this.account();
    return !!a && !!this.selfId && a.id === this.selfId;
  }

  safe(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  bannerUrl(a: Account): string | null {
    return a.header ? `url(${a.header})` : null;
  }

  followLabel(): string {
    const r = this.relationship();
    if (r?.requested) return 'Requested';
    if (r?.following) return 'Following';
    return 'Follow';
  }

  private async load(acct: string): Promise<void> {
    this.loading.set(true);
    try {
      const me = await this.mastodon.verifyCredentials();
      this.selfId = me?.id ?? null;

      // acct may be an id (numeric) or a handle; lookup handles handles, getAccount handles ids.
      const account = /^\d+$/.test(acct)
        ? await this.mastodon.getAccount(acct)
        : await this.mastodon.lookupAccount(acct);
      this.account.set(account);

      if (this.selfId !== account.id) {
        const rels = await this.mastodon.getRelationships([account.id]);
        this.relationship.set(rels[0] ?? null);
      } else {
        this.relationship.set(null);
      }

      await this.reloadStatuses();
    } finally {
      this.loading.set(false);
    }
  }

  /** Ordered tabs, used by both selectTab and the arrow-key roving handler. */
  private readonly tabOrder: ProfileTab[] = ['posts', 'replies', 'media'];

  selectTab(tab: ProfileTab): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    void this.reloadStatuses();
  }

  /** WAI-ARIA tablist keyboard support: Left/Right (and Home/End) move between
   *  the Posts / Replies / Media tabs and activate the focused one. */
  onTabKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const current = this.tabOrder.indexOf(this.tab());
    let next = current;
    switch (event.key) {
      case 'ArrowLeft':
        next = (current - 1 + this.tabOrder.length) % this.tabOrder.length;
        break;
      case 'ArrowRight':
        next = (current + 1) % this.tabOrder.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.tabOrder.length - 1;
        break;
    }
    const target = this.tabOrder[next];
    this.selectTab(target);
    const el = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`#account-tab-${target}`);
    el?.focus();
  }

  private tabParams(maxId?: string): Record<string, unknown> {
    const params: Record<string, unknown> = { limit: 20 };
    if (maxId) params['max_id'] = maxId;
    switch (this.tab()) {
      case 'posts':
        params['exclude_replies'] = true;
        break;
      case 'media':
        params['only_media'] = true;
        break;
      case 'replies':
      default:
        break;
    }
    return params;
  }

  async reloadStatuses(): Promise<void> {
    const a = this.account();
    if (!a) return;
    this.exhausted.set(false);
    this.loading.set(true);
    try {
      const list = await this.mastodon.accountStatuses(a.id, this.tabParams());
      this.statuses.set(list);
      if (!list.length) this.exhausted.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const a = this.account();
    if (!a || this.loading() || this.exhausted()) return;
    const last = this.statuses()[this.statuses().length - 1];
    if (!last) return;
    this.loading.set(true);
    try {
      const more = await this.mastodon.accountStatuses(a.id, this.tabParams(last.id));
      if (!more.length) {
        this.exhausted.set(true);
      } else {
        this.statuses.set([...this.statuses(), ...more]);
      }
    } finally {
      this.loading.set(false);
    }
  }

  async toggleFollow(): Promise<void> {
    const a = this.account();
    if (!a) return;
    this.followBusy.set(true);
    try {
      const following = this.relationship()?.following;
      const rel = following ? await this.mastodon.unfollowAccount(a.id) : await this.mastodon.followAccount(a.id);
      this.relationship.set(rel);
    } finally {
      this.followBusy.set(false);
    }
  }
}
