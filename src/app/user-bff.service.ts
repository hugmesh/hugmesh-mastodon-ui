import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Same-origin base; the fe-gateway proxies /bff/user/** to snapdragon-user-bff-api.
 *  Mirrors admin-ui's __SNAP_BFF_URL__ runtime override hook. */
const BFF = (globalThis as any).__SNAP_BFF_URL__ ?? '';

/** Self-block platforms the user-bff-api accepts (UserBlock.validPlatform). For
 *  this Mastodon remote: 'mastodon' for an external block, 'internal' for an
 *  internal-only block. */
export type BlockPlatform = 'matrix' | 'mastodon' | 'internal';

/** One self-block belonging to the caller — matched field-for-field to the
 *  user-bff-api {@code UserBlock} record. {@code userId} is server-set
 *  (owner = JWT subject) and never sent from the client. */
export interface UserBlock {
  id: string;
  userId?: string;
  target: string;
  platform: BlockPlatform;
  ts?: string;
}

/** POST /bff/user/blocks acknowledgement ({ block, pushed, external }). */
export interface BlockAck {
  block: UserBlock;
  pushed: boolean;
  external: string; // 'live' | 'stubbed' | 'n/a'
}

/** POST /bff/user/recommend-instance-block acknowledgement. */
export interface RecommendAck {
  recommended: boolean;
  instance: string;
  federation: unknown;
}

/**
 * USER-tier datastore for the caller's OWN self-blocks + the instance-block
 * recommendation that starts the USER→MOD→ADMIN chain. RxJS
 * {@link BehaviorSubject}-backed (the datastore pattern) so any view subscribing
 * to {@link blocks$} observes one source of truth; HttpClient transport to the
 * same-origin /bff/user/** paths authenticated by the HttpOnly {@code bff_}
 * cookie ({@code withCredentials}), which the fe-gateway's
 * BffCookieToBearerWebFilter converts to the bearer server-side. The
 * user-bff-api forces owner = JWT subject, so a user only ever sees/edits their
 * own blocks (server-side enforcement).
 *
 * Endpoints (user-bff-api BlockController @ /bff/user, hasRole('USER')):
 *   GET    /bff/user/blocks                   → list()
 *   POST   /bff/user/blocks                   → block({target, platform})
 *   DELETE /bff/user/blocks/{id}              → unblock(id)
 *   POST   /bff/user/recommend-instance-block → recommendInstanceBlock({instance, reason})
 */
@Injectable({ providedIn: 'root' })
export class UserBffService {
  private readonly http = inject(HttpClient);
  private readonly base = `${BFF}/bff/user`;

  private readonly blocksSubject = new BehaviorSubject<UserBlock[]>([]);
  /** The caller's own self-blocks (latest list loaded). */
  readonly blocks$: Observable<UserBlock[]> = this.blocksSubject.asObservable();

  /** GET /bff/user/blocks — list my self-blocks and push onto {@link blocks$}. */
  list(): Observable<UserBlock[]> {
    return this.http
      .get<UserBlock[]>(`${this.base}/blocks`, { withCredentials: true })
      .pipe(tap((blocks) => this.blocksSubject.next(blocks ?? [])));
  }

  /** POST /bff/user/blocks — create a self-block (durable row + best-effort
   *  external push). Refreshes the cached list on success. */
  block(target: string, platform: BlockPlatform): Observable<BlockAck> {
    return this.http
      .post<BlockAck>(`${this.base}/blocks`, { target, platform }, { withCredentials: true })
      .pipe(tap(() => this.list().subscribe()));
  }

  /** DELETE /bff/user/blocks/{id} — remove one of my self-blocks. Refreshes the list. */
  unblock(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.base}/blocks/${encodeURIComponent(id)}`, { withCredentials: true })
      .pipe(tap(() => this.list().subscribe()));
  }

  /** POST /bff/user/recommend-instance-block — recommend an instance block
   *  (starts the USER→MOD→ADMIN chain via federation-api). */
  recommendInstanceBlock(instance: string, reason: string): Observable<RecommendAck> {
    return this.http.post<RecommendAck>(
      `${this.base}/recommend-instance-block`,
      { instance, reason },
      { withCredentials: true },
    );
  }
}
