import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RoleActionsMenuComponent } from './role-actions-menu.component';
import { SessionService, SnapSession } from './session.service';

function makeSession(over: Partial<SnapSession> = {}): SnapSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice@gmail.com',
    provider: 'google',
    roles: ['user'],
    bffToken: 'tok',
    registrationComplete: true,
    matrix: null,
    mastodon: { token: 'm' },
    ...over,
  };
}

describe('RoleActionsMenuComponent', () => {
  let fixture: ComponentFixture<RoleActionsMenuComponent>;
  let component: RoleActionsMenuComponent;
  let session: SessionService;
  let httpMock: HttpTestingController;

  function setup(roles: string[], acct = 'bob@remote.example'): HTMLElement {
    session.set(makeSession({ roles }));
    component.acct = acct;
    component.accountId = '99';
    fixture.detectChanges();
    component.toggle(); // open the panel
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [RoleActionsMenuComponent],
      providers: [SessionService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(RoleActionsMenuComponent);
    component = fixture.componentInstance;
    session = TestBed.inject(SessionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  // ── TIER INVARIANT ──────────────────────────────────────────────────
  it('USER tier only: a plain user sees the USER tier but NOT the MOD or ADMIN tiers', () => {
    const el = setup(['user']);
    expect(el.querySelector('[data-testid="tier-user"]')).withContext('USER tier shown').not.toBeNull();
    expect(el.querySelector('[data-testid="tier-mod"]')).withContext('MOD tier hidden from user').toBeNull();
    expect(el.querySelector('[data-testid="tier-admin"]')).withContext('ADMIN tier hidden from user').toBeNull();
  });

  it('MOD tier: a mod sees USER + MOD but NOT the ADMIN tier (the invariant)', () => {
    const el = setup(['user', 'mod']);
    expect(el.querySelector('[data-testid="tier-user"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="tier-mod"]')).withContext('MOD tier shown').not.toBeNull();
    expect(el.querySelector('[data-testid="tier-admin"]')).withContext('MOD must not see ADMIN tier').toBeNull();
  });

  it('ADMIN tier: an admin sees all three tiers', () => {
    const el = setup(['user', 'admin']);
    expect(el.querySelector('[data-testid="tier-user"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="tier-mod"]')).withContext('admin inherits MOD tier').not.toBeNull();
    expect(el.querySelector('[data-testid="tier-admin"]')).withContext('ADMIN tier shown').not.toBeNull();
  });

  it('renders no trigger at all for a logged-out viewer', () => {
    session.clear();
    component.acct = 'bob@remote.example';
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="role-actions-trigger"]')).toBeNull();
  });

  // ── USER tier behaviour ─────────────────────────────────────────────
  it('USER block calls POST /bff/user/blocks with the mastodon platform', () => {
    setup(['user']);
    component.blockUser('mastodon');
    const post = httpMock.expectOne('/bff/user/blocks');
    expect(post.request.body).toEqual({ target: 'bob@remote.example', platform: 'mastodon' });
    post.flush({ block: { id: 'b', target: 'bob@remote.example', platform: 'mastodon' }, pushed: true, external: 'stubbed' });
    httpMock.expectOne('/bff/user/blocks').flush([]); // refresh
    expect(component.outcome()?.kind).toBe('status');
  });

  it('USER recommend-instance-block derives the instance from the acct domain', () => {
    setup(['user'], 'bob@remote.example');
    component.recommendInstanceBlock();
    const post = httpMock.expectOne('/bff/user/recommend-instance-block');
    expect(post.request.body.instance).toBe('remote.example');
    post.flush({ recommended: true, instance: 'remote.example', federation: {} });
    expect(component.outcome()?.kind).toBe('status');
  });

  it('hides self-actions and shows a self note when the target is the viewer', () => {
    session.set(makeSession({ roles: ['user'] }));
    component.acct = 'self@local';
    component.isSelf = true;
    fixture.detectChanges();
    component.toggle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="user-self-note"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="user-block-mastodon"]')).toBeNull();
  });

  // ── MOD tier behaviour ──────────────────────────────────────────────
  it('MOD server-wide instance block calls POST /bff/mod/block with platform mastodon', () => {
    setup(['user', 'mod'], 'bob@remote.example');
    component.serverBlock('instance');
    const post = httpMock.expectOne('/bff/mod/block');
    expect(post.request.body).toEqual({ platform: 'mastodon', scope: 'instance', target: 'remote.example', reason: undefined });
    post.flush({ blocked: { id: 'a', actor: 'm', action: 'block', platform: 'mastodon', target: 'remote.example', reason: null, result: 'stubbed', ts: '' }, external: 'stubbed', note: 'STUBBED externally' });
    expect(component.outcome()?.text).toContain('STUBBED');
  });

  it('MOD load queue + refer hit the moderation endpoints', () => {
    setup(['user', 'mod']);
    component.loadQueue();
    httpMock.expectOne('/bff/mod/moderation').flush({ requests: [{ id: 3, requester: 'x', kind: 'instance-block', target: 'remote.example', reason: null, status: 'recommended', modReferrer: null, adminDecider: null, ts: '' }] });
    expect(component.moderation().length).toBe(1);

    component.refer(3);
    httpMock.expectOne('/bff/mod/moderation/3/refer').flush({ request: { id: 3, requester: 'x', kind: 'instance-block', target: 'remote.example', reason: null, status: 'referred', modReferrer: 'me', adminDecider: null, ts: '' } });
    httpMock.expectOne('/bff/mod/moderation').flush({ requests: [] }); // refresh after refer
    expect(component.outcome()?.text).toContain('Referred');
  });

  // ── ADMIN tier is a STUB (no network call) ──────────────────────────
  it('ADMIN approve/deny is a stub: makes NO http call and discloses the admin console', () => {
    setup(['user', 'admin']);
    component.adminDecision('approve', 42);
    // httpMock.verify() in afterEach asserts there was no outgoing request.
    expect(component.outcome()?.kind).toBe('status');
    expect(component.outcome()?.text).toContain('admin console');
    expect(component.outcome()?.text.toLowerCase()).toContain('stub');
  });

  it('renders the visible admin stub note marked data-stub for admins', () => {
    const el = setup(['user', 'admin']);
    const note = el.querySelector('[data-testid="admin-stub-note"]');
    expect(note).not.toBeNull();
    expect(note?.getAttribute('data-stub')).toBe('true');
  });

  // ── a11y ────────────────────────────────────────────────────────────
  it('the trigger exposes aria-expanded reflecting the open state', () => {
    session.set(makeSession({ roles: ['user'] }));
    component.acct = 'bob@remote.example';
    fixture.detectChanges();
    const trigger = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="role-actions-trigger"]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    component.toggle();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('the outcome live region uses role=alert (assertive) for errors', () => {
    setup(['user'], 'local-only'); // bare handle → no instance → error path
    component.recommendInstanceBlock();
    fixture.detectChanges();
    const region = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="role-actions-outcome"]')!;
    expect(region.getAttribute('role')).toBe('alert');
    expect(component.outcome()?.kind).toBe('alert');
  });

  it('Escape closes the open panel', () => {
    setup(['user']);
    expect(component.open()).toBeTrue();
    const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="role-actions-panel"]')!;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(component.open()).toBeFalse();
  });
});
