import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UserBffService, UserBlock, BlockAck, RecommendAck } from './user-bff.service';
import { SessionService, SnapSession } from './session.service';

function makeSession(over: Partial<SnapSession> = {}): SnapSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice@gmail.com',
    provider: 'google',
    roles: ['user'],
    registrationComplete: true,
    ...over,
  };
}

describe('UserBffService', () => {
  let service: UserBffService;
  let httpMock: HttpTestingController;
  let session: SessionService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        UserBffService,
        SessionService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(UserBffService);
    httpMock = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionService);
    session.set(makeSession());
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('GET /bff/user/blocks sends the bff_ cookie (withCredentials, no bearer) and pushes onto blocks$', () => {
    const rows: UserBlock[] = [{ id: 'b1', target: '@evil@bad.example', platform: 'mastodon' }];
    let emitted: UserBlock[] = [];
    service.blocks$.subscribe((b) => (emitted = b));

    service.list().subscribe();
    const req = httpMock.expectOne('/bff/user/blocks');
    expect(req.request.method).toBe('GET');
    // Auth rides on the HttpOnly bff_ cookie (gateway → bearer), not a browser bearer.
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('authorization')).toBeFalse();
    req.flush(rows);

    expect(emitted).toEqual(rows);
  });

  it('POST /bff/user/blocks sends {target, platform} and refreshes the list', () => {
    const ack: BlockAck = {
      block: { id: 'b2', target: '@x@y.example', platform: 'mastodon' },
      pushed: true,
      external: 'stubbed',
    };
    service.block('@x@y.example', 'mastodon').subscribe();

    const post = httpMock.expectOne('/bff/user/blocks');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ target: '@x@y.example', platform: 'mastodon' });
    post.flush(ack);

    // tap() triggers a follow-up list() refresh
    const refresh = httpMock.expectOne('/bff/user/blocks');
    expect(refresh.request.method).toBe('GET');
    refresh.flush([]);
  });

  it('POST /bff/user/blocks supports an internal-only block platform', () => {
    service.block('local-user', 'internal').subscribe();
    const post = httpMock.expectOne('/bff/user/blocks');
    expect(post.request.body).toEqual({ target: 'local-user', platform: 'internal' });
    post.flush({ block: { id: 'b3', target: 'local-user', platform: 'internal' }, pushed: false, external: 'n/a' });
    httpMock.expectOne('/bff/user/blocks').flush([]);
  });

  it('DELETE /bff/user/blocks/{id} hits the per-id path and refreshes the list', () => {
    service.unblock('b1').subscribe();
    const del = httpMock.expectOne('/bff/user/blocks/b1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    httpMock.expectOne('/bff/user/blocks').flush([]);
  });

  it('POST /bff/user/recommend-instance-block sends {instance, reason}', () => {
    const ack: RecommendAck = { recommended: true, instance: 'bad.example', federation: {} };
    let got: RecommendAck | undefined;
    service.recommendInstanceBlock('bad.example', 'spam').subscribe((r) => (got = r));

    const req = httpMock.expectOne('/bff/user/recommend-instance-block');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ instance: 'bad.example', reason: 'spam' });
    req.flush(ack);
    expect(got).toEqual(ack);
  });
});
