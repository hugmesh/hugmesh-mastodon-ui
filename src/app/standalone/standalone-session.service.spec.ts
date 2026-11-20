import { TestBed } from '@angular/core/testing';
import { SessionService } from '../session.service';
import { StandaloneSessionService } from './standalone-session.service';

describe('StandaloneSessionService', () => {
  let svc: StandaloneSessionService;
  let session: SessionService;
  let realFetch: typeof fetch;

  const reply = (status: number, body?: unknown) =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(StandaloneSessionService);
    session = TestBed.inject(SessionService);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  it('starts loading', () => {
    expect(svc.state()).toBe('loading');
  });

  it('a 200 fills the session the rest of the UI reads, with the roles Akkoma reports', async () => {
    globalThis.fetch = (() =>
      reply(200, { id: 'alice', label: 'Alice', provider: 'akkoma', roles: ['user', 'admin'], registrationComplete: true })) as typeof fetch;
    await svc.init('');
    expect(svc.state()).toBe('signed-in');
    expect(session.loggedIn()).toBeTrue();
    expect(session.isAdmin()).toBeTrue();
    expect(session.fullyRegistered()).toBeTrue();
  });

  it('a 401 is signed out and clears any stale session', async () => {
    session.set({ id: 'old', label: 'Old', provider: 'akkoma', roles: ['user'], registrationComplete: true });
    globalThis.fetch = (() => reply(401)) as typeof fetch;
    await svc.init('');
    expect(svc.state()).toBe('signed-out');
    expect(session.loggedIn()).toBeFalse();
  });

  it('any other status, or no answer, is an error and never a signed-in state', async () => {
    globalThis.fetch = (() => reply(502)) as typeof fetch;
    await svc.init('');
    expect(svc.state()).toBe('error');
    globalThis.fetch = (() => Promise.reject(new TypeError('network'))) as typeof fetch;
    await svc.init('');
    expect(svc.state()).toBe('error');
    expect(session.loggedIn()).toBeFalse();
  });

  it('asks with the session cookie and without caching', async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = ((_: unknown, i?: RequestInit) => {
      init = i;
      return reply(401);
    }) as typeof fetch;
    await svc.init('');
    expect(init?.credentials).toBe('include');
    expect(init?.cache).toBe('no-store');
  });

  it('reads why a sign-in ended from the query string, and ignores anything else', () => {
    expect(StandaloneSessionService.problemFrom('?login=denied')).toBe('denied');
    expect(StandaloneSessionService.problemFrom('?login=failed')).toBe('failed');
    expect(StandaloneSessionService.problemFrom('?login=invalid')).toBe('invalid');
    expect(StandaloneSessionService.problemFrom('?login=<script>')).toBeNull();
    expect(StandaloneSessionService.problemFrom('')).toBeNull();
  });

  it('the sign-in link returns to the current page, and only to a same-site path', () => {
    expect(svc.loginUrl('/notifications')).toBe('/bff/login?next=%2Fnotifications');
    expect(svc.loginUrl('//evil.example')).toBe('/bff/login?next=%2F');
    expect(svc.loginUrl('evil')).toBe('/bff/login?next=%2F');
  });

  it('sign-out posts to the server and clears the session either way', async () => {
    session.set({ id: 'a', label: 'A', provider: 'akkoma', roles: ['user'], registrationComplete: true });
    let seen: { url: string; method?: string } | undefined;
    globalThis.fetch = ((u: string, i?: RequestInit) => {
      seen = { url: u, method: i?.method };
      return Promise.reject(new TypeError('offline'));
    }) as typeof fetch;
    await svc.signOut();
    expect(seen).toEqual({ url: '/bff/logout', method: 'POST' });
    expect(svc.state()).toBe('signed-out');
    expect(session.loggedIn()).toBeFalse();
  });
});
