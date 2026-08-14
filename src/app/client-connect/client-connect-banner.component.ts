import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';

import { ClientConnectService } from './client-connect.service';
import { SSE_NOTIFICATION_EVENT, ShellSseNotification, VIEW_RELOAD_EVENT } from '../shell-events';

/**
 * The CLIENT-CONNECT banner at the top of the Mastodon tab: what a user who
 * holds the external-client grant needs in order to point their OWN Mastodon
 * client (Tusky, Ivory, Elk, …) at this deployment.
 *
 * Renders NOTHING for a user without the grant — this is a capability they were
 * specifically given, not general chrome.
 *
 * The rule this component exists to enforce: it shows a URL ONLY when
 * {@link ClientConnectService} has SEEN the instance answer a real client-API
 * request. A front-door 200 is not proof — the gateway serves this very SPA for
 * unrouted paths.
 */
@Component({
  selector: 'hug-client-connect-banner',
  standalone: true,
  templateUrl: './client-connect-banner.component.html',
  styleUrl: './client-connect-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientConnectBannerComponent implements OnInit, OnDestroy {
  private readonly clientConnect = inject(ClientConnectService);

  readonly state = this.clientConnect.state;

  ngOnInit(): void {
    void this.clientConnect.check();
    if (typeof window === 'undefined') return;
    window.addEventListener(VIEW_RELOAD_EVENT, this.recheck);
    window.addEventListener(SSE_NOTIFICATION_EVENT, this.onShellNotification);
  }

  ngOnDestroy(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener(VIEW_RELOAD_EVENT, this.recheck);
    window.removeEventListener(SSE_NOTIFICATION_EVENT, this.onShellNotification);
  }

  /** Property, not method, so add/removeEventListener share one reference. */
  private readonly recheck = (): void => { void this.clientConnect.check(); };

  /**
   * LIVE UPDATE from the shell's SSE stream. `role-change` is the one category
   * that can flip this banner — the external-client grant IS a role — so a grant
   * or revocation arriving over SSE re-runs the check instead of leaving a stale
   * banner (or a stale absence of one) until the next full page load. Other
   * categories are ignored: re-probing the instance for them would cost a
   * request and cannot change the answer.
   */
  private readonly onShellNotification = (event: Event): void => {
    const detail = (event as CustomEvent<ShellSseNotification>).detail;
    if (detail?.category === 'role-change') void this.clientConnect.check();
  };
}
