import { Component, ElementRef, Input, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs';
import { SessionService } from './session.service';
import { UserBffService } from './user-bff.service';
import { ModBffService, ModerationRequest } from './mod-bff.service';
import { AdminBffService } from './admin-bff.service';

/** Async-result kind for the live region. */
type Outcome = { kind: 'status' | 'alert'; text: string } | null;

/**
 * The single reusable ROLE-TIERED action surface for the Mastodon remote. It
 * reads the authenticated user's role from {@link SessionService} (derived from
 * the JWT/Casdoor roles) and conditionally renders three additive tiers:
 *
 *  - USER tier  (every authed user → session.isUser): self-block/mute a Mastodon
 *    or internal account (POST/DELETE /bff/user/blocks) and recommend an instance
 *    block to mods (POST /bff/user/recommend-instance-block).
 *  - MOD tier   (session.isMod = mod OR admin): server-wide block a user/instance
 *    (POST /bff/mod/block) and triage the moderation queue (GET /bff/mod/moderation)
 *    with refer-to-admin (POST /bff/mod/moderation/{id}/refer).
 *  - ADMIN tier (session.isAdmin = admin only): approve/deny an instance-block or
 *    user-removal request, wired to admin-bff-api's
 *    {@code POST /bff/admin/moderation/{id}/decide} (which proxies to
 *    federation-api's decide→apply chain: an approved user-removal auto-applies a
 *    kill-switch override; a denied re-decision rearms it). A failed decide
 *    surfaces an alert and NEVER renders as applied.
 *
 * CRITICAL INVARIANT: because isAdmin is false for a plain mod and isMod/isAdmin
 * are both false for a plain user, a MOD never sees the ADMIN tier and a USER
 * never sees the MOD/ADMIN tier. The bff-apis also enforce this server-side; the
 * gating here is defence-in-depth.
 */
@Component({
  selector: 'snap-mastodon-role-actions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './role-actions-menu.component.html',
  styleUrl: './role-actions-menu.component.scss',
})
export class RoleActionsMenuComponent {
  readonly session = inject(SessionService);
  private readonly userBff = inject(UserBffService);
  private readonly modBff = inject(ModBffService);
  private readonly adminBff = inject(AdminBffService);

  /** The full Mastodon acct (e.g. user@instance.example or local-user) of the
   *  account these actions target. */
  @Input({ required: true }) acct = '';
  /** Optional numeric account id (used as the target for server-wide blocks). */
  @Input() accountId: string | null = null;
  /** Optional status id (for context; not required by any endpoint). */
  @Input() statusId: string | null = null;
  /** Hide self-actions when the target is the viewer's own account. */
  @Input() isSelf = false;

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly outcome = signal<Outcome>(null);
  readonly reason = signal('');

  /** Per-instance id prefix so each help element is UNIQUE — a timeline renders
   *  one role-actions menu per toot, and each control's aria-describedby must
   *  resolve to ITS OWN menu's help, not the first menu's. */
  private static seq = 0;
  private readonly uid = `role-actions-${RoleActionsMenuComponent.seq++}`;
  readonly ids = {
    panel: `${this.uid}-panel`,
    reason: `${this.uid}-reason`,
    reasonHelp: `${this.uid}-reason-help`,
    userHelp: `${this.uid}-user-help`,
    modHelp: `${this.uid}-mod-help`,
    adminHelp: `${this.uid}-admin-help`,
  };

  /** Loaded lazily when a mod opens the queue. */
  readonly moderation = signal<ModerationRequest[]>([]);
  readonly queueLoaded = signal(false);

  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('panel') panel?: ElementRef<HTMLElement>;

  /** The instance/domain part of an acct (user@instance → instance); empty for a
   *  bare local handle. Used to seed the recommend-instance-block + server-wide
   *  instance block. */
  readonly instance = computed(() => {
    const at = this.acct.lastIndexOf('@');
    return at > 0 ? this.acct.slice(at + 1) : '';
  });

  /** Show the menu trigger at all only to an authenticated user. */
  showMenu = computed(() => this.session.isUser());

  toggle(): void {
    this.open.set(!this.open());
    if (this.open()) {
      // Focus the first interactive control in the panel after it renders.
      setTimeout(() => {
        const first = this.panel?.nativeElement.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        first?.focus();
      });
    }
  }

  close(returnFocus = true): void {
    this.open.set(false);
    if (returnFocus) this.trigger?.nativeElement.focus();
  }

  onPanelKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.close();
    }
  }

  private ok(text: string): void {
    this.outcome.set({ kind: 'status', text });
  }
  private fail(text: string): void {
    this.outcome.set({ kind: 'alert', text });
  }

  // ── USER tier ──────────────────────────────────────────────────────
  /** Self-block this account on Mastodon (external) or internal-only. */
  blockUser(platform: 'mastodon' | 'internal'): void {
    if (!this.acct) return;
    this.busy.set(true);
    this.outcome.set(null);
    this.userBff.block(this.acct, platform).subscribe({
      next: (ack) =>
        this.ok(
          `Blocked @${this.acct} (${platform}). External push: ${ack.external}.`,
        ),
      error: () => this.fail(`Could not block @${this.acct}. Please try again.`),
      complete: () => this.busy.set(false),
    });
  }

  /** Recommend an instance block to the mods (USER→MOD→ADMIN chain). */
  recommendInstanceBlock(): void {
    const inst = this.instance();
    if (!inst) {
      this.fail('This is a local account — no remote instance to recommend blocking.');
      return;
    }
    this.busy.set(true);
    this.outcome.set(null);
    this.userBff.recommendInstanceBlock(inst, this.reason() || 'Recommended from a status').subscribe({
      next: () => this.ok(`Recommended a block of ${inst} to the moderators.`),
      error: () => this.fail(`Could not send the recommendation for ${inst}.`),
      complete: () => this.busy.set(false),
    });
  }

  // ── MOD tier ───────────────────────────────────────────────────────
  /** Server-wide block of this user or its instance (mod-bff; external STUBBED). */
  serverBlock(scope: 'user' | 'instance'): void {
    const target = scope === 'instance' ? this.instance() : this.accountId ?? this.acct;
    if (!target) {
      this.fail('No target available for the server-wide block.');
      return;
    }
    this.busy.set(true);
    this.outcome.set(null);
    this.modBff
      .block({ platform: 'mastodon', scope, target, reason: this.reason() || undefined })
      .subscribe({
        next: (res) =>
          this.ok(
            `Server-wide ${scope} block recorded for ${target}. External: ${res.external}.` +
              (res.note ? ` ${res.note}` : ''),
          ),
        error: () => this.fail(`Could not record the server-wide ${scope} block.`),
        complete: () => this.busy.set(false),
      });
  }

  /** Load the moderation triage queue (mod-bff). */
  loadQueue(): void {
    this.busy.set(true);
    this.modBff.loadModeration().subscribe({
      next: (rows) => {
        this.moderation.set(rows);
        this.queueLoaded.set(true);
        this.ok(`Loaded ${rows.length} moderation request(s).`);
      },
      error: () => this.fail('Could not load the moderation queue.'),
      complete: () => this.busy.set(false),
    });
  }

  /** Refer/escalate a queue row up to an admin (the only mod path). */
  refer(id: number): void {
    this.busy.set(true);
    this.modBff.refer(id).subscribe({
      next: (r) => {
        this.moderation.set(this.modBffSnapshot());
        this.ok(`Referred request #${id} to an admin (now ${r.status}).`);
      },
      error: () => this.fail(`Could not refer request #${id}.`),
      complete: () => this.busy.set(false),
    });
  }

  /** Read the latest cached queue after a refer refreshes it. */
  private modBffSnapshot(): ModerationRequest[] {
    let rows: ModerationRequest[] = [];
    this.modBff.moderation$.subscribe((r) => (rows = r)).unsubscribe();
    return rows;
  }

  // ── ADMIN tier ─────────────────────────────────────────────────────
  /** Approve/deny a queued instance-block or user-removal request: POSTs
   *  admin-bff-api's {@code /bff/admin/moderation/{id}/decide}, which proxies to
   *  federation-api's decide→apply chain (bearer-forwarded, so federation-api
   *  authorises + scopes the decision to the caller's own domain). On success the
   *  (mod-tier shared) queue is refreshed by the service so the new status
   *  renders everywhere; a failure is surfaced as an alert and the request is
   *  NEVER treated as decided. */
  adminDecision(decision: 'approve' | 'deny', id: number): void {
    this.busy.set(true);
    this.outcome.set(null);
    // NOTE: busy is reset via finalize(), NOT the subscribe `complete` callback —
    // per the Observable contract `complete` never fires after `error`, so relying
    // on it here would leave `busy` (and therefore every action button in this
    // menu, since [disabled]="busy()" gates all of them) stuck disabled forever
    // after a single failed decide.
    this.adminBff
      .decide(id, decision === 'approve')
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (r) => {
          this.moderation.set(this.modBffSnapshot());
          this.ok(`${decision === 'approve' ? 'Approved' : 'Denied'} request #${id} (now ${r.status}).`);
        },
        error: () => this.fail(`Could not ${decision} request #${id} — it was NOT applied.`),
      });
  }
}
