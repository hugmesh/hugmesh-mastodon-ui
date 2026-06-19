import { TestBed } from '@angular/core/testing';
import { MastodonService, MASTODON_BASE_URL, BFF_BASE_URL, MASTODON_PROXY_MODE, Status } from './mastodon.service';
import { accessibleName } from './accessible-name';

/** Minimal fetch Response stub. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number; link?: string }): Response {
  const headers = new Headers();
  if (init?.link) headers.set('Link', init.link);
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

describe('MastodonService', () => {
  const BASE = 'https://mastodon.test';
  const BFF = 'https://bff.test';
  let service: MastodonService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MASTODON_BASE_URL, useValue: BASE },
        { provide: BFF_BASE_URL, useValue: BFF },
        MastodonService,
      ],
    });
    service = TestBed.inject(MastodonService);
    localStorage.clear();
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  afterEach(() => localStorage.clear());

  function lastUrl(): string {
    return String(fetchSpy.calls.mostRecent().args[0]);
  }
  function lastInit(): RequestInit {
    return (fetchSpy.calls.mostRecent().args[1] ?? {}) as RequestInit;
  }
  function authHeader(): string | undefined {
    return (lastInit().headers as Record<string, string>)?.['Authorization'];
  }

  it('reads the brokered token from the shared snap.session in localStorage', async () => {
    localStorage.setItem('snap.session', JSON.stringify({ mastodon: { token: 'brokered-123' } }));
    fetchSpy.and.resolveTo(jsonResponse([]));
    await service.homeTimeline();
    expect(authHeader()).toBe('Bearer brokered-123');
  });

  it('sends no Authorization header when there is no session token', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    await service.homeTimeline();
    expect(authHeader()).toBeUndefined();
  });

  it('lets an explicitly-set token win over the session token', async () => {
    localStorage.setItem('snap.session', JSON.stringify({ mastodon: { token: 'brokered' } }));
    service.setAccessToken('explicit-xyz');
    fetchSpy.and.resolveTo(jsonResponse([]));
    await service.homeTimeline();
    expect(authHeader()).toBe('Bearer explicit-xyz');
  });

  it('tolerates a malformed snap.session without throwing', async () => {
    localStorage.setItem('snap.session', '{not valid json');
    fetchSpy.and.resolveTo(jsonResponse([]));
    await expectAsync(service.homeTimeline()).toBeResolved();
    expect(authHeader()).toBeUndefined();
  });

  it('builds bracketed-array query params (Mastodon convention) for arrays', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    await service.getRelationships(['1', '2']);
    const url = lastUrl();
    expect(url).toContain('/api/v1/accounts/relationships');
    expect(url).toContain('id%5B%5D=1');
    expect(url).toContain('id%5B%5D=2');
  });

  it('omits undefined/null params from the query string', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    await service.trendingStatuses(5, undefined);
    const url = lastUrl();
    expect(url).toContain('limit=5');
    expect(url).not.toContain('offset=');
  });

  it('returns the provided fallback (not throw) when a GET fails', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 500 }));
    const result = await service.homeTimeline();
    expect(result).toEqual([]);
  });

  it('throws when a GET without a fallback fails', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 404 }));
    await expectAsync(service.getStatus('abc')).toBeRejectedWithError(/GET .* failed: 404/);
  });

  it('treats a 401 from verifyCredentials as "not signed in" (null)', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 401 }));
    expect(await service.verifyCredentials()).toBeNull();
  });

  it('parses next/prev cursors from the RFC5988 Link header for favourites', async () => {
    const link =
      '<https://mastodon.test/api/v1/favourites?max_id=999>; rel="next", ' +
      '<https://mastodon.test/api/v1/favourites?min_id=111>; rel="prev"';
    fetchSpy.and.resolveTo(jsonResponse([{ id: 's1' }], { link }));
    const page = await service.favouritesPage({ limit: 20 });
    expect(page.statuses.length).toBe(1);
    expect(page.nextMaxId).toBe('999');
    expect(page.prevMinId).toBe('111');
  });

  it('returns an empty page (no throw) when a paged GET fails', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 500 }));
    const page = await service.bookmarksPage();
    expect(page).toEqual({ statuses: [], nextMaxId: null, prevMinId: null });
  });

  it('forces local=true for the community timeline', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    await service.communityTimeline();
    expect(lastUrl()).toContain('/api/v1/timelines/public');
    expect(lastUrl()).toContain('local=true');
  });

  it('strips a leading # and encodes the hashtag in the timeline path', async () => {
    fetchSpy.and.resolveTo(jsonResponse([]));
    await service.hashtagTimeline('#cats');
    expect(lastUrl()).toContain('/api/v1/timelines/tag/cats');
  });

  it('POSTs JSON with the idempotency key header when posting a status', async () => {
    const created = { id: 'new1' } as Status;
    fetchSpy.and.resolveTo(jsonResponse(created));
    const result = await service.postStatus({ status: 'hello' }, 'key-7');
    const init = lastInit();
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-7');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'hello' });
    expect(result).toEqual(created);
  });

  it('does NOT set Content-Type on multipart media uploads (browser sets the boundary)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ id: 'm1', url: null }, { status: 202 }));
    await service.uploadMedia(new File(['x'], 'a.png', { type: 'image/png' }));
    const headers = (lastInit().headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(lastUrl()).toContain('/api/v2/media');
  });

  it('submits poll votes as a choices array to the votes endpoint', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ id: 'p1' }));
    await service.voteOnPoll('p1', [0, 2]);
    expect(lastUrl()).toContain('/api/v1/polls/p1/votes');
    expect(JSON.parse(String(lastInit().body))).toEqual({ choices: [0, 2] });
  });

  // ── AI-cloak (poison-before-ingest via the BFF proxy) ──────────────────

  it('routes a protected upload through the BFF media proxy, NOT the homeserver', async () => {
    localStorage.setItem('snap.session', JSON.stringify({ bffToken: 'bff-jwt', mastodon: { token: 'mast' } }));
    fetchSpy.and.resolveTo(jsonResponse({ id: 'm9', url: null, cloak: { ref: 'r9', status: 'pending', mode: 'glaze' } }));
    const att = await service.uploadMediaProtected(new File(['x'], 'a.png', { type: 'image/png' }), 'glaze');
    expect(lastUrl()).toBe(`${BFF}/bff/user/media/upload`);
    expect(lastUrl()).not.toContain('/api/v2/media');
    // authed with the BFF token, not the per-service Mastodon token
    expect(authHeader()).toBe('Bearer bff-jwt');
    // multipart: no explicit Content-Type (browser sets the boundary)
    const headers = (lastInit().headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(att.cloak?.ref).toBe('r9');
  });

  it('sends platform=mastodon and the chosen mode in the multipart body', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ id: 'm1', url: null }));
    await service.uploadMediaProtected(new File(['x'], 'a.png', { type: 'image/png' }), 'nightshade');
    const body = lastInit().body as FormData;
    expect(body.get('platform')).toBe('mastodon');
    expect(body.get('mode')).toBe('nightshade');
    expect(body.get('file')).toBeTruthy();
  });

  it('returns an unavailable capability when the BFF is unreachable (honest fallback)', async () => {
    fetchSpy.and.rejectWith(new Error('network'));
    const cap = await service.cloakCapability();
    expect(cap.available).toBeFalse();
    expect(cap.backend).toBe('none');
  });

  it('reads the worker backend from the BFF capability endpoint', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ available: true, backend: 'cuda', defaultMode: 'glaze', expectedTime: '~1 min' }));
    const cap = await service.cloakCapability();
    expect(lastUrl()).toBe(`${BFF}/bff/user/media/capability`);
    expect(cap.available).toBeTrue();
    expect(cap.backend).toBe('cuda');
  });

  it('polls the BFF status endpoint (bffToken) for the poison decision', async () => {
    localStorage.setItem('snap.session', JSON.stringify({ bffToken: 'bff-jwt' }));
    fetchSpy.and.resolveTo(jsonResponse({ ref: 'r9', status: 'protected', mode: 'glaze', backend: 'cuda' }));
    const res = await service.cloakStatus('r9');
    expect(lastUrl()).toBe(`${BFF}/bff/user/media/status/r9`);
    expect(authHeader()).toBe('Bearer bff-jwt');
    expect(res.status).toBe('protected');
  });

  // ── WIRE-FORMAT a11y: screen_reader_name (snake_case, real homeserver/BFF
  //    shape) must populate what accessibleName() reads ────────────────────
  //
  // Regression guard for the silent-no-op bug: the service parses Account JSON
  // via raw `as Account` casts with NO snake_case→camelCase remapping (the whole
  // Account is consumed snake_case — display_name, statuses_count, …). The
  // earlier camelCase `screenReaderName` interface field therefore never
  // populated from the real wire JSON, so the ASCII-announce a11y feature
  // silently fell back to the non-ASCII display_name. These fixtures use the
  // REAL wire casing `screen_reader_name`, which the component accessors read.

  /** Minimal snake_case Account exactly as the homeserver/BFF emits it. */
  function wireAccount(over: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: 'a1', username: 'taro', acct: 'taro', display_name: '山田太郎', ...over };
  }

  it('parses the wire snake_case screen_reader_name so accessibleName announces the ASCII name (getAccount)', async () => {
    fetchSpy.and.resolveTo(jsonResponse(wireAccount({ screen_reader_name: 'Yamada Taro' })));
    const a = await service.getAccount('a1');
    expect(a.screen_reader_name).toBe('Yamada Taro');
    // The non-ASCII display_name is shown visually, but the ASCII name is announced.
    expect(accessibleName(a.display_name, a.screen_reader_name)).toBe('Yamada Taro');
  });

  it('parses the wire snake_case screen_reader_name from lookupAccount', async () => {
    fetchSpy.and.resolveTo(jsonResponse(wireAccount({ screen_reader_name: 'Yamada Taro' })));
    const a = await service.lookupAccount('taro');
    expect(accessibleName(a.display_name, a.screen_reader_name)).toBe('Yamada Taro');
  });

  it('parses the wire snake_case screen_reader_name on the v2 search account results', async () => {
    fetchSpy.and.resolveTo(
      jsonResponse({ accounts: [wireAccount({ screen_reader_name: 'Yamada Taro' })], statuses: [], hashtags: [] }),
    );
    const results = await service.search('taro', { type: 'accounts' });
    const a = results.accounts[0];
    expect(accessibleName(a.display_name, a.screen_reader_name)).toBe('Yamada Taro');
  });

  it('parses the wire snake_case screen_reader_name on the nested status account + notification account', async () => {
    const acc = wireAccount({ screen_reader_name: 'Yamada Taro' });
    fetchSpy.and.resolveTo(jsonResponse({ id: 's1', account: acc } as unknown));
    const status = await service.getStatus('s1');
    expect(accessibleName(status.account.display_name, status.account.screen_reader_name)).toBe('Yamada Taro');

    fetchSpy.and.resolveTo(jsonResponse([{ id: 'n1', type: 'mention', account: acc, status: null }]));
    const notes = await service.notifications();
    expect(accessibleName(notes[0].account.display_name, notes[0].account.screen_reader_name)).toBe('Yamada Taro');
  });

  it('falls back to the (non-ASCII) display_name when the wire Account omits screen_reader_name', async () => {
    fetchSpy.and.resolveTo(jsonResponse(wireAccount()));
    const a = await service.getAccount('a1');
    expect(a.screen_reader_name).toBeUndefined();
    expect(accessibleName(a.display_name, a.screen_reader_name)).toBe('山田太郎');
  });
});

// ---------------------------------------------------------------------------
// D6 homeserver BFF-proxy cutover (MASTODON_PROXY_MODE flag, ships dark)
// ---------------------------------------------------------------------------

describe('MastodonService (D6 BFF-proxy mode)', () => {
  const BASE = 'https://mastodon.test';
  const BFF = 'https://bff.test';
  let fetchSpy: jasmine.Spy;

  function jsonOk(body: unknown): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  function makeService(proxyMode: boolean): MastodonService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MASTODON_BASE_URL, useValue: BASE },
        { provide: BFF_BASE_URL, useValue: BFF },
        { provide: MASTODON_PROXY_MODE, useValue: proxyMode },
        MastodonService,
      ],
    });
    return TestBed.inject(MastodonService);
  }

  function lastUrl(): string {
    return String(fetchSpy.calls.mostRecent().args[0]);
  }
  function lastHeaders(): Record<string, string> {
    return ((fetchSpy.calls.mostRecent().args[1] ?? {}) as RequestInit).headers as Record<string, string>;
  }

  beforeEach(() => {
    localStorage.clear();
    fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(jsonOk([]));
  });
  afterEach(() => localStorage.clear());

  it('DEFAULTS OFF: the runtime override hook is not enabled (ships dark)', () => {
    // No global override set → default-off, so the legacy direct path stays live.
    expect((globalThis as any).__SNAP_MASTODON_PROXY_MODE__).not.toBe(true);
  });

  it('flag OFF → byte-identical legacy path: homeserver base + per-service Mastodon token', async () => {
    localStorage.setItem(
      'snap.session',
      JSON.stringify({ bffToken: 'jwt-abc', mastodon: { token: 'masto-xyz' } }),
    );
    const service = makeService(false);
    await service.homeTimeline();
    expect(lastUrl()).toBe(`${BASE}/api/v1/timelines/home`);
    expect(lastHeaders()['Authorization']).toBe('Bearer masto-xyz');
  });

  it('flag ON → routes through same-origin /bff/user/mastodon with the native sub-path verbatim', async () => {
    localStorage.setItem('snap.session', JSON.stringify({ bffToken: 'jwt-abc' }));
    const service = makeService(true);
    await service.homeTimeline();
    expect(lastUrl()).toBe(`${BFF}/bff/user/mastodon/api/v1/timelines/home`);
  });

  it('flag ON → attaches the Casdoor bffToken bearer, NOT the per-service Mastodon token', async () => {
    localStorage.setItem(
      'snap.session',
      JSON.stringify({ bffToken: 'jwt-abc', mastodon: { token: 'masto-xyz' } }),
    );
    const service = makeService(true);
    await service.homeTimeline();
    expect(lastHeaders()['Authorization']).toBe('Bearer jwt-abc');
  });

  it('flag ON → mutating POST carries no X-CSRF header and no cookie credentials (bearer chain, CSRF disabled)', async () => {
    localStorage.setItem('snap.session', JSON.stringify({ bffToken: 'jwt-abc' }));
    const service = makeService(true);
    fetchSpy.and.resolveTo(jsonOk({ id: 's1' }));
    await service.favourite('s1');
    const init = (fetchSpy.calls.mostRecent().args[1] ?? {}) as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(lastUrl()).toBe(`${BFF}/bff/user/mastodon/api/v1/statuses/s1/favourite`);
    expect(headers['Authorization']).toBe('Bearer jwt-abc');
    expect(headers['X-CSRF']).toBeUndefined();
    expect(headers['X-CSRF-Token']).toBeUndefined();
    // The proxy owns upstream-token custody; no cookie credentials mode is set.
    expect(init.credentials).toBeUndefined();
  });

  it('flag ON → query string preserved through the proxy prefix', async () => {
    localStorage.setItem('snap.session', JSON.stringify({ bffToken: 'jwt-abc' }));
    const service = makeService(true);
    await service.homeTimeline({ limit: 20, max_id: '99' });
    const url = lastUrl();
    expect(url.startsWith(`${BFF}/bff/user/mastodon/api/v1/timelines/home?`)).toBeTrue();
    expect(url).toContain('limit=20');
    expect(url).toContain('max_id=99');
  });
});
