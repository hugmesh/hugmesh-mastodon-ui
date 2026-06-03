import { Injectable, InjectionToken, inject } from '@angular/core';

/** Base URL of the Mastodon instance (mastodon.snapdragon.systems). */
export const MASTODON_BASE_URL = new InjectionToken<string>('MASTODON_BASE_URL', {
  factory: () => (globalThis as any).__SNAP_MASTODON_URL__ ?? 'https://mastodon.snapdragon.systems',
});

export interface Toot {
  id: string;
  content: string;
  account: { username: string; display_name: string };
  created_at: string;
}

/**
 * Thin Mastodon REST API wrapper. Auth piggybacks on the access token obtained
 * via Casdoor OIDC sign-in (admin-created accounts + Google sign-up); the login
 * remote brokers a per-service Mastodon token and writes it into the shared
 * `snap.session`. As a federated remote we read that token ourselves (the host
 * no longer injects it); a host may still call setAccessToken() to override.
 * The module never renders its own login form.
 */
@Injectable({ providedIn: 'root' })
export class MastodonService {
  private readonly baseUrl = inject(MASTODON_BASE_URL);
  private accessToken: string | null = null;

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /** Explicitly-set token wins; otherwise read the brokered Mastodon token from
   *  the shared SnapSession in localStorage (written by the login remote). */
  private token(): string | null {
    if (this.accessToken) return this.accessToken;
    try {
      const s = JSON.parse(localStorage.getItem('snap.session') ?? 'null');
      return s?.mastodon?.token ?? null;
    } catch { return null; }
  }

  private headers(): Record<string, string> {
    const t = this.token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async homeTimeline(): Promise<Toot[]> {
    const r = await fetch(`${this.baseUrl}/api/v1/timelines/home`, { headers: this.headers() });
    return r.ok ? r.json() : [];
  }

  async publicTimeline(): Promise<Toot[]> {
    const r = await fetch(`${this.baseUrl}/api/v1/timelines/public?local=true`, { headers: this.headers() });
    return r.ok ? r.json() : [];
  }

  async post(status: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers() },
      body: JSON.stringify({ status }),
    });
  }
}
