import { TestBed } from '@angular/core/testing';
import { MastodonService, MASTODON_BASE_URL, BFF_BASE_URL, Status } from './mastodon.service';

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
});
