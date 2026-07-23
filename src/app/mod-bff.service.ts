import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';

/** Same-origin base; the fe-gateway proxies /bff/mod/** to hugmesh-mod-bff-api. */
const BFF = (globalThis as any).__HUG_BFF_URL__ ?? '';

/** Body for POST /bff/mod/block. */
export interface ModBlockRequest {
  platform: 'matrix' | 'mastodon';
  scope: 'user' | 'instance';
  target: string;
  reason?: string;
}

/** Response from POST /bff/mod/block: { blocked, external, note? }. The external
 *  homeserver-admin call is STUBBED server-side; {@code note} discloses that and
 *  the action is always written to the local audit table. */
export interface ModBlockResult {
  blocked: ModAction;
  external: string; // 'stubbed' | 'ok' | 'degraded:...'
  note?: string;
}

/** A local mod-action audit row — matched to mod-bff-api's {@code ModAction}. */
export interface ModAction {
  id: string;
  actor: string;
  action: string;
  platform: string;
  target: string;
  reason: string | null;
  result: string;
  ts: string;
}

/** A federation moderation-queue row — matched field-for-field to mod-bff-api's
 *  {@code ModerationRequestDto}.
 *   - kind:   'instance-block' | 'user-removal'
 *   - status: 'recommended' | 'referred' | 'approved' | 'denied' */
export interface ModerationRequest {
  id: number;
  requester: string;
  kind: string;
  target: string;
  reason: string | null;
  status: string;
  modReferrer: string | null;
  adminDecider: string | null;
  ts: string;
}

/**
 * MOD-tier datastore for the moderation queue + server-wide block. Every endpoint
 * is gated server-side by hasAnyRole('MOD','ADMIN') (admins also use these), so
 * this surface is shown to MOD or ADMIN. RxJS {@link BehaviorSubject}-backed (the
 * moderation queue is cached so the console + triage observe one source of truth
 * and a mutation can refresh without re-fetching); HttpClient transport to the
 * same-origin /bff/mod/** paths authenticated by the HttpOnly {@code bff_} cookie
 * ({@code withCredentials}), which the fe-gateway's BffCookieToBearerWebFilter
 * converts to the bearer server-side.
 *
 * Endpoints (mod-bff-api ModController @ /bff/mod, hasAnyRole('MOD','ADMIN')):
 *   POST /bff/mod/block                  → block({platform, scope, target, reason})
 *   GET  /bff/mod/moderation[?status=]   → loadModeration(status?)
 *   POST /bff/mod/moderation/{id}/refer  → refer(id)   (escalate UP to admin)
 */
@Injectable({ providedIn: 'root' })
export class ModBffService {
  private readonly http = inject(HttpClient);
  private readonly base = `${BFF}/bff/mod`;

  private readonly moderationSubject = new BehaviorSubject<ModerationRequest[]>([]);
  /** The cached moderation queue, observable by any view. */
  readonly moderation$: Observable<ModerationRequest[]> = this.moderationSubject.asObservable();

  /** GET /bff/mod/moderation — load the triage queue and push it onto the subject. */
  loadModeration(status?: string): Observable<ModerationRequest[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.http
      .get<{ requests: ModerationRequest[] }>(`${this.base}/moderation${q}`, { withCredentials: true })
      .pipe(
        map((r) => r.requests ?? []),
        tap((requests) => this.moderationSubject.next(requests)),
      );
  }

  /** POST /bff/mod/moderation/{id}/refer — refer/escalate a request UP to an
   *  admin (the ONLY mod escalation path; a mod never removes directly).
   *  Refreshes the cached queue so the referred row reflects its new status. */
  refer(id: number): Observable<ModerationRequest> {
    return this.http
      .post<{ request: ModerationRequest }>(`${this.base}/moderation/${id}/refer`, {}, { withCredentials: true })
      .pipe(
        map((r) => r.request),
        tap(() => this.loadModeration().subscribe()),
      );
  }

  /** POST /bff/mod/block — block a user/instance server-wide. The external
   *  homeserver-admin call is STUBBED server-side, but the action is always
   *  recorded in the local audit table; surface {@code external}/{@code note}
   *  honestly. */
  block(req: ModBlockRequest): Observable<ModBlockResult> {
    return this.http.post<ModBlockResult>(`${this.base}/block`, req, { withCredentials: true });
  }
}
