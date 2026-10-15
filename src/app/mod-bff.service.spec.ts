import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ModBffService, ModerationRequest, ModBlockResult, StepUpRequired, isStepUpRequired } from './mod-bff.service';
import { SessionService, HugSession } from './session.service';

function makeSession(over: Partial<HugSession> = {}): HugSession {
  return {
    id: 'google:mod@gmail.com',
    label: 'mod@gmail.com',
    provider: 'google',
    roles: ['user', 'mod'],
    registrationComplete: true,
    ...over,
  };
}

function makeRequest(over: Partial<ModerationRequest> = {}): ModerationRequest {
  return {
    id: 7,
    requester: 'google:alice@gmail.com',
    kind: 'instance-block',
    target: 'bad.example',
    reason: 'spam',
    status: 'recommended',
    modReferrer: null,
    adminDecider: null,
    ts: new Date().toISOString(),
    ...over,
  };
}

describe('ModBffService', () => {
  let service: ModBffService;
  let httpMock: HttpTestingController;
  let session: SessionService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        ModBffService,
        SessionService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(ModBffService);
    httpMock = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionService);
    session.set(makeSession());
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('GET /bff/mod/moderation unwraps {requests} and pushes onto moderation$', () => {
    const rows = [makeRequest()];
    let emitted: ModerationRequest[] = [];
    service.moderation$.subscribe((r) => (emitted = r));

    service.loadModeration().subscribe();
    const req = httpMock.expectOne('/bff/mod/moderation');
    expect(req.request.method).toBe('GET');
    // Auth rides on the HttpOnly bff_ cookie (gateway → bearer), not a browser bearer.
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('authorization')).toBeFalse();
    req.flush({ requests: rows });

    expect(emitted).toEqual(rows);
  });

  it('GET /bff/mod/moderation forwards an optional ?status filter', () => {
    service.loadModeration('referred').subscribe();
    const req = httpMock.expectOne('/bff/mod/moderation?status=referred');
    expect(req.request.method).toBe('GET');
    req.flush({ requests: [] });
  });

  it('POST /bff/mod/moderation/{id}/refer escalates and refreshes the queue', () => {
    const referred = makeRequest({ status: 'referred', modReferrer: 'mod@x' });
    let got: ModerationRequest | undefined;
    service.refer(7).subscribe((r) => (got = r));

    const post = httpMock.expectOne('/bff/mod/moderation/7/refer');
    expect(post.request.method).toBe('POST');
    post.flush({ request: referred });
    expect(got).toEqual(referred);

    // tap() refreshes the queue
    const refresh = httpMock.expectOne('/bff/mod/moderation');
    expect(refresh.request.method).toBe('GET');
    refresh.flush({ requests: [referred] });
  });

  it('POST /bff/mod/block sends the platform/scope/target/reason body and surfaces the stub note', () => {
    const result: ModBlockResult = {
      blocked: {
        id: 'a1', actor: 'mod', action: 'block', platform: 'mastodon',
        target: 'bad.example', reason: 'spam', result: 'stubbed', ts: '',
      },
      external: 'stubbed',
      note: 'external homeserver admin call is STUBBED — action recorded in the local audit table only',
    };
    let got: ModBlockResult | undefined;
    service
      .block({ platform: 'mastodon', scope: 'instance', target: 'bad.example', reason: 'spam' })
      .subscribe((r) => (got = r));

    const post = httpMock.expectOne('/bff/mod/block');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({
      platform: 'mastodon', scope: 'instance', target: 'bad.example', reason: 'spam',
    });
    post.flush(result);
    expect(got?.external).toBe('stubbed');
    expect(got?.note).toContain('STUBBED');
  });

  describe('block() step-up signal', () => {
    const req = { platform: 'mastodon', scope: 'user', target: '99' } as const;

    function blockError(status: number, headers: Record<string, string>): unknown {
      let err: unknown;
      service.block(req).subscribe({ error: (e) => (err = e) });
      httpMock.expectOne('/bff/mod/block').flush('requires step-up', { status, statusText: 'x', headers });
      return err;
    }

    it('a 403 carrying X-Step-Up-Required becomes a typed StepUpRequired, not the raw HTTP error', () => {
      const err = blockError(403, { 'X-Step-Up-Required': 'mod-bff' });
      expect(isStepUpRequired(err)).toBeTrue();
      expect((err as StepUpRequired).flavour).toBe('mod-bff');
    });

    it('a 403 WITHOUT the header (a role refusal) passes through unchanged', () => {
      const err = blockError(403, {});
      expect(isStepUpRequired(err)).toBeFalse();
      expect((err as HttpErrorResponse).status).toBe(403);
    });

    it('the header on a non-403 is not a step-up (only the 403 leg is)', () => {
      const err = blockError(500, { 'X-Step-Up-Required': 'mod-bff' });
      expect(isStepUpRequired(err)).toBeFalse();
      expect((err as HttpErrorResponse).status).toBe(500);
    });
  });
});
