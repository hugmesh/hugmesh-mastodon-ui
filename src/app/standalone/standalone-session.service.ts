import { Injectable, inject, signal } from '@angular/core';
import { SessionService, HugSession } from '../session.service';

export type StandaloneState = 'loading' | 'signed-out' | 'signed-in' | 'error';

/** Why a sign-in attempt ended at the sign-in screen (the server redirects with ?login=<reason>). */
export type LoginProblem = 'denied' | 'failed' | 'invalid' | null;

/**
 * The sign-in state of a STANDALONE deployment (hugmesh-akkoma-web in front of Akkoma). There is no
 * host shell and no Casdoor: the web service signs the user in through Akkoma's own OAuth and keeps the
 * access token server-side, so the browser only ever holds an opaque HttpOnly session cookie. This service
 * asks `/bff/user/session` who that cookie belongs to and fills the same {@link SessionService} the rest
 * of the UI already reads.
 */
@Injectable({ providedIn: 'root' })
export class StandaloneSessionService {
  private readonly session = inject(SessionService);

  readonly state = signal<StandaloneState>('loading');
  readonly problem = signal<LoginProblem>(null);

  /** Reads the session once at start-up. Never throws. */
  async init(search: string = globalThis.location?.search ?? ''): Promise<void> {
    this.problem.set(StandaloneSessionService.problemFrom(search));
    try {
      const r = await fetch('/bff/user/session', { credentials: 'include', cache: 'no-store' });
      if (r.status === 401) {
        this.session.clear();
        this.state.set('signed-out');
        return;
      }
      if (!r.ok) {
        this.state.set('error');
        return;
      }
      this.session.set((await r.json()) as HugSession);
      this.state.set('signed-in');
    } catch {
      this.state.set('error');
    }
  }

  /** Where the sign-in button goes: Akkoma's own sign-in page, returning to the page the user is on. */
  loginUrl(path: string = globalThis.location?.pathname ?? '/'): string {
    const next = path.startsWith('/') && !path.startsWith('//') ? path : '/';
    return `/bff/login?next=${encodeURIComponent(next)}`;
  }

  async signOut(): Promise<void> {
    try {
      await fetch('/bff/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* the local state is cleared either way; the session cookie expires on its own */
    }
    this.session.clear();
    this.state.set('signed-out');
  }

  static problemFrom(search: string): LoginProblem {
    const v = new URLSearchParams(search).get('login');
    return v === 'denied' || v === 'failed' || v === 'invalid' ? v : null;
  }
}
