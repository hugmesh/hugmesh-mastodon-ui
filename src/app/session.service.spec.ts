import { TestBed } from '@angular/core/testing';
import { SessionService, SnapSession } from './session.service';

function makeSession(over: Partial<SnapSession> = {}): SnapSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice@gmail.com',
    provider: 'google',
    roles: [],
    bffToken: 'tok-1',
    registrationComplete: false,
    matrix: null,
    mastodon: null,
    ...over,
  };
}

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [SessionService] });
    service = TestBed.inject(SessionService);
  });

  afterEach(() => localStorage.clear());

  it('starts logged-out when localStorage has no session', () => {
    expect(service.session()).toBeNull();
    expect(service.loggedIn()).toBeFalse();
    expect(service.isUser()).toBeFalse();
    expect(service.isAdmin()).toBeFalse();
    expect(service.isMod()).toBeFalse();
    expect(service.fullyRegistered()).toBeFalse();
  });

  it('isUser is true for any logged-in session (USER tier = every authed user)', () => {
    service.set(makeSession({ roles: [] }));
    expect(service.isUser()).toBeTrue();
    service.set(makeSession({ roles: ['user'] }));
    expect(service.isUser()).toBeTrue();
  });

  it('isMod is true for a "mod" role, an "admin" role, but not a plain "user"', () => {
    service.set(makeSession({ roles: ['user'] }));
    expect(service.isMod()).toBeFalse();
    service.set(makeSession({ roles: ['user', 'mod'] }));
    expect(service.isMod()).toBeTrue();
    service.set(makeSession({ roles: ['admin'] }));
    expect(service.isMod()).withContext('admin inherits the mod surface').toBeTrue();
  });

  it('enforces the tier invariant: a MOD never sees ADMIN, a USER never sees MOD/ADMIN', () => {
    // plain user
    service.set(makeSession({ roles: ['user'] }));
    expect(service.isUser()).toBeTrue();
    expect(service.isMod()).withContext('USER must not reach MOD tier').toBeFalse();
    expect(service.isAdmin()).withContext('USER must not reach ADMIN tier').toBeFalse();
    // moderator
    service.set(makeSession({ roles: ['user', 'mod'] }));
    expect(service.isMod()).toBeTrue();
    expect(service.isAdmin()).withContext('MOD must not reach ADMIN tier').toBeFalse();
    // admin
    service.set(makeSession({ roles: ['user', 'admin'] }));
    expect(service.isMod()).toBeTrue();
    expect(service.isAdmin()).toBeTrue();
  });

  it('hydrates an existing session from localStorage on construction', () => {
    localStorage.setItem('snap.session', JSON.stringify(makeSession({ roles: ['admin'] })));
    const fresh = TestBed.runInInjectionContext(() => new SessionService());
    expect(fresh.loggedIn()).toBeTrue();
    expect(fresh.isAdmin()).toBeTrue();
  });

  it('tolerates malformed JSON in localStorage and reports logged-out', () => {
    localStorage.setItem('snap.session', '{not valid json');
    const fresh = TestBed.runInInjectionContext(() => new SessionService());
    expect(fresh.session()).toBeNull();
    expect(fresh.loggedIn()).toBeFalse();
  });

  it('set() persists to localStorage and flips the derived signals', () => {
    service.set(makeSession({ roles: ['admin'], registrationComplete: true }));
    expect(service.loggedIn()).toBeTrue();
    expect(service.isAdmin()).toBeTrue();
    expect(service.fullyRegistered()).toBeTrue();
    expect(JSON.parse(localStorage.getItem('snap.session')!).roles).toEqual(['admin']);
  });

  it('isAdmin only when the roles array includes "admin"', () => {
    service.set(makeSession({ roles: ['user'] }));
    expect(service.isAdmin()).toBeFalse();
    service.set(makeSession({ roles: ['user', 'admin'] }));
    expect(service.isAdmin()).toBeTrue();
  });

  it('mastodonDomainLocked reflects the lowercased on-wire MASTODON_DOMAINLOCKED marker', () => {
    service.set(makeSession({ roles: ['user'] }));
    expect(service.mastodonDomainLocked()).withContext('no marker → false').toBeFalse();
    // The admin-bff domainlockRoles() lowercases the marker before folding it in.
    service.set(makeSession({ roles: ['user', 'mastodon_domainlocked'] }));
    expect(service.mastodonDomainLocked()).toBeTrue();
  });

  it('mastodonDomainLocked accepts the ROLE_-prefixed / upper-case marker variant too', () => {
    service.set(makeSession({ roles: ['ROLE_USER', 'ROLE_MASTODON_DOMAINLOCKED'] }));
    expect(service.mastodonDomainLocked()).toBeTrue();
  });

  it('mastodonDomainLocked is NOT triggered by the Matrix domain-lock marker', () => {
    service.set(makeSession({ roles: ['user', 'matrix_domainlocked'] }));
    expect(service.mastodonDomainLocked()).withContext('matrix lock must not lock mastodon').toBeFalse();
  });

  it('mastodonDomainLocked is false when logged out', () => {
    expect(service.mastodonDomainLocked()).toBeFalse();
  });

  it('clear() removes the session from localStorage and resets the signal', () => {
    service.set(makeSession());
    service.clear();
    expect(service.session()).toBeNull();
    expect(localStorage.getItem('snap.session')).toBeNull();
  });

  it('re-reads localStorage when another in-page instance broadcasts a change', () => {
    expect(service.loggedIn()).toBeFalse();
    localStorage.setItem('snap.session', JSON.stringify(makeSession({ roles: ['admin'] })));
    window.dispatchEvent(new Event('snap-session-change'));
    expect(service.isAdmin()).toBeTrue();
  });
});
