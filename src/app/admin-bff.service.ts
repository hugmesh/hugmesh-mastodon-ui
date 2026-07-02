import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ModBffService, ModerationRequest } from './mod-bff.service';

/** Same-origin base; the fe-gateway proxies /bff/admin/** to snapdragon-admin-bff-api. */
const BFF = (globalThis as any).__SNAP_BFF_URL__ ?? '';

/**
 * ADMIN-tier datastore for the moderation decide→apply chain. Shown to ADMIN only
 * (session.isAdmin). Every call is gated server-side by
 * hasRole('ADMIN')(admin-bff-api's AdminController) which itself bearer-forwards
 * the caller to federation-api's own hasAnyRole('ADMIN','SUPERADMIN') +
 * per-domain scope — so this remote never authorises a decision on its own, only
 * relays the caller's identity. HttpClient transport to the same-origin
 * {@code /bff/admin/**} path authenticated by the HttpOnly {@code bff_} cookie
 * ({@code withCredentials}), identical convention to {@link ModBffService}.
 *
 * Endpoint (admin-bff-api AdminController @ /bff/admin, hasRole('ADMIN')):
 *   POST /bff/admin/moderation/{id}/decide?approve=<bool> → decide(id, approve)
 *
 * An approved {@code user-removal} is auto-applied downstream as an active
 * kill-switch override; a denied re-decision rearms it. A failed/degraded decide
 * propagates as the call's error — this service NEVER reports a fake success.
 */
@Injectable({ providedIn: 'root' })
export class AdminBffService {
  private readonly http = inject(HttpClient);
  private readonly modBff = inject(ModBffService);
  private readonly base = `${BFF}/bff/admin`;

  /** POST /bff/admin/moderation/{id}/decide?approve=<bool> — approve or deny a
   *  referred moderation request. Refreshes the (mod-tier-shared) moderation
   *  queue on success; a failure leaves the queue untouched and propagates. */
  decide(id: number, approve: boolean): Observable<ModerationRequest> {
    return this.http
      .post<ModerationRequest>(`${this.base}/moderation/${id}/decide?approve=${approve}`, {}, { withCredentials: true })
      .pipe(tap(() => this.modBff.loadModeration().subscribe()));
  }
}
