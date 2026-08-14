import { Injectable, inject, signal } from '@angular/core';

import { BFF_BASE_URL } from '../mastodon.service';

/**
 * What the client-connect banner is allowed to tell the user, and nothing more.
 *
 * `available` is the ONLY state that carries a URL, and it is reached only after
 * a probe has SEEN the instance answer a real Mastodon client-API request. Every
 * other state carries a `reason` instead: a URL that will fail is worse than no
 * URL, because the user pastes it into Tusky/Ivory, gets a generic failure, and
 * cannot tell whether they mistyped it or we lied.
 */
export type ClientConnectState =
  /** The probe has not finished. */
  | { status: 'checking' }
  /** The caller does not hold ROLE_MASTODON_EXTERNAL_CLIENT — no banner. */
  | { status: 'not-granted' }
  /** Granted, but the endpoint does NOT speak the client API. */
  | { status: 'unavailable'; reason: string; needed: string }
  /** Granted AND proven: `instanceUrl` answered /api/v1/instance with a real
   *  instance document. `domain` is the instance's OWN idea of its address,
   *  which is what a client must be given when it differs from the URL we
   *  probed. */
  | { status: 'available'; instanceUrl: string; domain: string };

/**
 * Proves — or refuses to claim — that this deployment can host a user's OWN
 * Mastodon client.
 *
 * The trap this exists to avoid is the same one the Matrix side hit: the
 * fe-gateway serves this SPA's index.html for every unrouted path, so an
 * unrouted `/api/v1/instance` returns HTTP 200 with `text/html` and passes any
 * check that only looks at the status code. Three conditions are required
 * before a URL is shown:
 *
 *   1. a 2xx,
 *   2. a JSON content-type (HTML is the SPA fallback, by definition),
 *   3. a body carrying the instance document's own identity (`domain` on the
 *      v2 shape, `uri` on v1) — proof it is Mastodon answering.
 */
@Injectable({ providedIn: 'root' })
export class ClientConnectService {
  /** The owner-scoped surface whose @PreAuthorize is exactly the external-client
   *  grant (`hasRole('MATRIX_EXTERNAL_CLIENT') or hasRole('MASTODON_EXTERNAL_CLIENT')`),
   *  so its 200-vs-403 IS the grant check. Deliberately NOT read off the session
   *  `roles[]`: admin-bff folds only the *_DOMAINLOCKED markers into the
   *  session, so a client-side *_EXTERNAL_CLIENT check is permanently false. */
  private static readonly GRANT_PROBE_PATH = '/bff/user/connected-clients';

  /** The instance document every Mastodon client reads first. */
  private static readonly INSTANCE_PATH = '/api/v1/instance';

  private readonly bffBaseUrl = inject(BFF_BASE_URL);

  readonly state = signal<ClientConnectState>({ status: 'checking' });

  /** Grant first (cheap, and a denial means we never probe), then the protocol
   *  proof. Never throws; an unexpected failure resolves to `unavailable`. */
  async check(): Promise<void> {
    this.state.set({ status: 'checking' });
    try {
      if (!(await this.hasGrant())) {
        this.state.set({ status: 'not-granted' });
        return;
      }
      this.state.set(await this.probeInstance());
    } catch (err) {
      this.state.set({
        status: 'unavailable',
        reason: `The connectivity check itself failed: ${String(err)}`,
        needed: ClientConnectService.INSTANCE_PATH,
      });
    }
  }

  /** 200 ⇒ the caller holds an external-client role; anything else ⇒ treat as
   *  no grant. Fail-closed: guessing wrong here shows a capability the user
   *  does not have. */
  private async hasGrant(): Promise<boolean> {
    try {
      const r = await fetch(`${this.bffBaseUrl}${ClientConnectService.GRANT_PROBE_PATH}`, {
        credentials: 'include',
      });
      return r.status === 200;
    } catch {
      return false;
    }
  }

  /** Probe THIS deployment's origin — what a user would type into their client.
   *  Built from `location.origin` rather than a relative path: under the host
   *  shell a relative fetch resolves against the SHELL's document URL. */
  private async probeInstance(): Promise<ClientConnectState> {
    const origin = this.origin();
    const needed = 'A gateway route for the Mastodon client API (/api/v1/**) on this origin.';
    if (!origin) {
      return { status: 'unavailable', reason: 'No browser origin is available to probe.', needed };
    }

    let response: Response;
    try {
      response = await fetch(`${origin}${ClientConnectService.INSTANCE_PATH}`, {
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      return {
        status: 'unavailable',
        reason: `${origin}${ClientConnectService.INSTANCE_PATH} could not be reached (${String(err)}).`,
        needed,
      };
    }

    if (!response.ok) {
      return {
        status: 'unavailable',
        reason: `${origin}${ClientConnectService.INSTANCE_PATH} answered HTTP ${response.status}.`,
        needed,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      return {
        status: 'unavailable',
        reason: `${origin}${ClientConnectService.INSTANCE_PATH} answered HTTP 200 with content-type `
          + `"${contentType || 'none'}" — that is this app's HTML, not the instance. `
          + `The path is not routed to Mastodon.`,
        needed,
      };
    }

    let body: { domain?: unknown; uri?: unknown };
    try {
      body = await response.json();
    } catch (err) {
      return {
        status: 'unavailable',
        reason: `${origin}${ClientConnectService.INSTANCE_PATH} returned JSON that could not be parsed (${String(err)}).`,
        needed,
      };
    }

    // v2 calls it `domain`, v1 `uri`. Either proves Mastodon answered.
    const domain = typeof body?.domain === 'string' ? body.domain
      : typeof body?.uri === 'string' ? body.uri : '';
    if (!domain) {
      return {
        status: 'unavailable',
        reason: `${origin}${ClientConnectService.INSTANCE_PATH} returned JSON with no instance domain — `
          + `it is not the Mastodon client API.`,
        needed,
      };
    }

    return { status: 'available', instanceUrl: origin, domain };
  }

  /** The browser origin, or '' in a non-browser context. */
  private origin(): string {
    return typeof window === 'undefined' ? '' : window.location.origin;
  }
}
