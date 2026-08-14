import { TestBed } from '@angular/core/testing';

import { BFF_BASE_URL } from '../mastodon.service';
import { ClientConnectService } from './client-connect.service';

/**
 * These specs encode the ONE rule that matters here: a URL is rendered only
 * against evidence that the instance answered a real client-API request.
 *
 * The trap being defended against is real and was shipped once: the fe-gateway
 * serves this SPA's index.html for every unrouted path, so a probe that only
 * checked `response.ok` saw HTTP 200 on /api/v1/instance and concluded Mastodon
 * was reachable. It was the Angular app answering. Verified live on the local
 * stack 2026-08-14 — the front door returns `content-type: text/html` +
 * `<!doctype html>` for that path.
 */
describe('ClientConnectService', () => {
  let service: ClientConnectService;
  const originalFetch = globalThis.fetch;

  function routeFetch(routes: Record<string, () => Promise<Response>>): void {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      for (const path of Object.keys(routes)) {
        if (url.endsWith(path)) return routes[path]();
      }
      return Promise.reject(new Error(`unrouted probe: ${url}`));
    }) as typeof fetch;
  }

  function json(body: unknown, status = 200): Promise<Response> {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }

  /** The SPA fallback: HTTP 200, but it is index.html, not the instance. */
  function spaFallback(): Promise<Response> {
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as unknown as Response);
  }

  const GRANTED = () => json([], 200);
  const DENIED = () => json({ error: 'forbidden' }, 403);

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: BFF_BASE_URL, useValue: '' }] });
    service = TestBed.inject(ClientConnectService);
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  it('renders NOTHING for a caller without the external-client grant (403)', async () => {
    routeFetch({ '/bff/user/connected-clients': DENIED });

    await service.check();

    expect(service.state()).toEqual({ status: 'not-granted' });
  });

  it('does not even probe the instance when the grant is absent', async () => {
    let probes = 0;
    routeFetch({
      '/bff/user/connected-clients': DENIED,
      '/api/v1/instance': () => { probes++; return json({ uri: 'example.test' }); },
    });

    await service.check();

    expect(probes).toBe(0);
  });

  it('REFUSES to publish a URL when /api/v1/instance is the SPA fallback', async () => {
    routeFetch({
      '/bff/user/connected-clients': GRANTED,
      '/api/v1/instance': spaFallback,
    });

    await service.check();

    const state = service.state();
    expect(state.status).toBe('unavailable');
    if (state.status !== 'unavailable') return;
    expect(state.reason).toContain('text/html');
    expect(state.reason).toContain('not the instance');
    // And crucially: no URL anywhere in the payload the banner renders.
    expect(Object.keys(state)).not.toContain('instanceUrl');
  });

  it('REFUSES to publish a URL when the JSON carries no instance domain', async () => {
    routeFetch({
      '/bff/user/connected-clients': GRANTED,
      '/api/v1/instance': () => json({ hello: 'world' }),
    });

    await service.check();

    expect(service.state().status).toBe('unavailable');
  });

  it('REFUSES to publish a URL on a non-2xx from the instance endpoint', async () => {
    routeFetch({
      '/bff/user/connected-clients': GRANTED,
      '/api/v1/instance': () => json({ error: 'nope' }, 403),
    });

    await service.check();

    const state = service.state();
    expect(state.status).toBe('unavailable');
    if (state.status !== 'unavailable') return;
    expect(state.reason).toContain('403');
  });

  it('publishes the origin ONLY after a real instance document comes back (v1 `uri`)', async () => {
    routeFetch({
      '/bff/user/connected-clients': GRANTED,
      // The exact shape mastodon-web v4.3.1 returns on this stack.
      '/api/v1/instance': () => json({ uri: 'localhost', title: 'Mastodon', version: '4.3.1' }),
    });

    await service.check();

    expect(service.state()).toEqual({
      status: 'available',
      instanceUrl: window.location.origin,
      domain: 'localhost',
    });
  });

  it('accepts the v2 instance shape (`domain`) too', async () => {
    routeFetch({
      '/bff/user/connected-clients': GRANTED,
      '/api/v1/instance': () => json({ domain: 'social.example', title: 'Example' }),
    });

    await service.check();

    const state = service.state();
    expect(state.status).toBe('available');
    if (state.status !== 'available') return;
    expect(state.domain).toBe('social.example');
  });

  it('fails CLOSED when the grant probe itself errors (never shows a URL)', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('network down'))) as typeof fetch;

    await service.check();

    expect(service.state()).toEqual({ status: 'not-granted' });
  });
});
