import { TestBed } from '@angular/core/testing';
import { MastodonService, MASTODON_BASE_URL, Status } from './mastodon.service';

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
  let service: MastodonService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: MASTODON_BASE_URL, useValue: BASE }, MastodonService],
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
});
