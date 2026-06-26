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

  it('MOD-isolation invariant: a mod who loads the queue gets NO per-row admin approve/deny buttons', () => {
    // The admin approve/deny controls live INSIDE each mod-queue row (gated by
    // session.isAdmin()). They only render after the queue is loaded, so the
    // tier-section tests above don't exercise them. Prove a MOD never sees them.
    const el = setup(['user', 'mod']);
    component.loadQueue();
    httpMock.expectOne('/bff/mod/moderation').flush({
      requests: [{ id: 7, requester: 'x', kind: 'instance-block', target: 'remote.example', reason: null, status: 'recommended', modReferrer: null, adminDecider: null, ts: '' }],
    });
    fixture.detectChanges();
    // The mod row + its refer button render…
    expect(el.querySelector('[data-testid="mod-queue-row-7"]')).withContext('mod sees the queue row').not.toBeNull();
    expect(el.querySelector('[data-testid="mod-refer-7"]')).withContext('mod sees refer').not.toBeNull();
    // …but the per-row admin controls do NOT.
    expect(el.querySelector('[data-testid="admin-approve-7"]')).withContext('MOD must not see per-row Approve').toBeNull();
    expect(el.querySelector('[data-testid="admin-deny-7"]')).withContext('MOD must not see per-row Deny').toBeNull();
    expect(el.querySelector('.admin-action')).withContext('no admin-action control leaks to a mod').toBeNull();
  });

  it('ADMIN sees the per-row admin approve/deny controls once the queue is loaded', () => {
    const el = setup(['user', 'admin']);
    component.loadQueue();
    httpMock.expectOne('/bff/mod/moderation').flush({
      requests: [{ id: 7, requester: 'x', kind: 'instance-block', target: 'remote.example', reason: null, status: 'recommended', modReferrer: null, adminDecider: null, ts: '' }],
    });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="admin-approve-7"]')).withContext('admin sees per-row Approve').not.toBeNull();
    expect(el.querySelector('[data-testid="admin-deny-7"]')).withContext('admin sees per-row Deny').not.toBeNull();
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

  it('Escape closes the open panel and restores focus to the trigger', () => {
    // Attach to the document so focus assertions are meaningful (WCAG 2.1.2).
    document.body.appendChild(fixture.nativeElement);
    const el = setup(['user']);
    expect(component.open()).toBeTrue();
    const panel = el.querySelector('[data-testid="role-actions-panel"]')!;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(component.open()).toBeFalse();
    const trigger = el.querySelector('[data-testid="role-actions-trigger"]')!;
    expect(document.activeElement).withContext('focus returns to the menu trigger').toBe(trigger);
    fixture.nativeElement.remove();
  });

  // ── HELP TEXT (sighted + low/no-sight) ──────────────────────────────
  /** Assert a control's aria-describedby resolves to a real, non-empty element. */
  function expectDescribedBy(el: HTMLElement, controlTestId: string): void {
    const control = el.querySelector(`[data-testid="${controlTestId}"]`)!;
    expect(control).withContext(`${controlTestId} should be present`).not.toBeNull();
    const describedBy = control.getAttribute('aria-describedby');
    expect(describedBy).withContext(`${controlTestId} needs aria-describedby`).toBeTruthy();
    const help = el.querySelector(`#${describedBy}`);
    expect(help).withContext(`aria-describedby of ${controlTestId} must resolve to an element`).not.toBeNull();
    expect(help!.textContent?.trim().length).withContext('help must be non-empty').toBeGreaterThan(0);
  }

  it('wires the Reason field to a visible, non-empty help via aria-describedby', () => {
    const el = setup(['user']);
    expectDescribedBy(el, 'role-actions-reason');
    const help = el.querySelector('[data-testid="role-actions-reason-help"]')!;
    expect(help.classList).toContain('control-help');
  });

  it('describes every USER-tier action with the safety help', () => {
    const el = setup(['user']);
    const help = el.querySelector('[data-testid="tier-user-help"]')!;
    expect(help.classList).toContain('control-help');
    expect(help.textContent?.toLowerCase()).toContain('block');
    for (const id of ['user-block-mastodon', 'user-block-internal', 'user-recommend-instance']) {
      expectDescribedBy(el, id);
    }
  });

  it('describes every MOD-tier action with the server-wide-impact help', () => {
    const el = setup(['user', 'mod']);
    const help = el.querySelector('[data-testid="tier-mod-help"]')!;
    expect(help.textContent?.toLowerCase()).toContain('server');
    for (const id of ['mod-block-user', 'mod-block-instance', 'mod-load-queue']) {
      expectDescribedBy(el, id);
    }
  });

  it('describes the STUBBED admin Approve/Deny via the honest stub note', () => {
    const el = setup(['user', 'admin']);
    component.loadQueue();
    httpMock.expectOne('/bff/mod/moderation').flush({
      requests: [{ id: 7, requester: 'x', kind: 'instance-block', target: 'evil.example', reason: null, status: 'recommended', modReferrer: null, adminDecider: null, ts: '' }],
    });
    fixture.detectChanges();

    const note = el.querySelector('[data-testid="admin-stub-note"]')!;
    const noteId = note.getAttribute('id');
    expect(noteId).withContext('the stub note needs an id to be referenced').toBeTruthy();
    for (const id of ['admin-approve-7', 'admin-deny-7']) {
      const btn = el.querySelector(`[data-testid="${id}"]`)!;
      expect(btn.getAttribute('aria-describedby')).toBe(noteId);
    }
  });

  it('gives the Refer button an accessibleName naming the target + a title hint', () => {
    const el = setup(['user', 'mod']);
    component.loadQueue();
    httpMock.expectOne('/bff/mod/moderation').flush({
      requests: [{ id: 3, requester: 'x', kind: 'report', target: 'bob@remote.example', reason: null, status: 'open', modReferrer: null, adminDecider: null, ts: '' }],
    });
    fixture.detectChanges();
    const refer = el.querySelector('[data-testid="mod-refer-3"]')!;
    expect(refer.getAttribute('aria-label')).toContain('bob@remote.example');
    expect((refer.getAttribute('title') ?? '').toLowerCase()).toContain('admin');
  });

  it('gives each menu instance a UNIQUE panel/help id (no cross-linking in a timeline)', () => {
    const a = TestBed.createComponent(RoleActionsMenuComponent);
    a.componentInstance.acct = 'x@a.example';
    a.detectChanges();
    const b = TestBed.createComponent(RoleActionsMenuComponent);
    b.componentInstance.acct = 'y@b.example';
    b.detectChanges();
    expect(a.componentInstance.ids.panel).not.toBe(b.componentInstance.ids.panel);
    expect(a.componentInstance.ids.userHelp).not.toBe(b.componentInstance.ids.userHelp);
  });
});
