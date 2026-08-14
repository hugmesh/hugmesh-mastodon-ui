import { TestBed } from '@angular/core/testing';

import { BFF_BASE_URL, MASTODON_PROXY_MODE } from './mastodon.service';
import { MastodonStreamService, parseSseField } from './mastodon-stream.service';

describe('parseSseField', () => {
  it('splits "name:value" with NO space (Spring-style writers)', () => {
    expect(parseSseField('data:{"id":"1"}')).toEqual({ name: 'data', value: '{"id":"1"}' });
  });

  it('strips exactly ONE leading space (Mastodon streaming writes "data: ")', () => {
    expect(parseSseField('data: {"id":"1"}')).toEqual({ name: 'data', value: '{"id":"1"}' });
  });

  it('preserves a second leading space (only ONE is stripped)', () => {
    expect(parseSseField('data:  x')).toEqual({ name: 'data', value: ' x' });
  });

  it('splits on the FIRST colon only', () => {
    expect(parseSseField('data:{"t":"12:30"}')).toEqual({ name: 'data', value: '{"t":"12:30"}' });
  });

  it('returns null for blank lines, comments and colon-less lines', () => {
    expect(parseSseField('')).toBeNull();
    expect(parseSseField(':thump')).toBeNull();
    expect(parseSseField('nope')).toBeNull();
  });
});

/**
 * The live-stream transport.
 *
 * The endpoint is REAL: MastodonProxyController forwards
 * `/bff/user/mastodon/api/v1/streaming/**` verbatim and HsReverseProxy streams
 * it unbuffered. Whether it REACHES a streaming server is a deployment
 * question, so every "no" path below must land in `unsupported` with a reason —
 * a silently-quiet stream and a working-but-idle one look identical to a user,
 * and only one of them is worth an operator's time.
 */
describe('MastodonStreamService', () => {
  let service: MastodonStreamService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: BFF_BASE_URL, useValue: '' },
        { provide: MASTODON_PROXY_MODE, useValue: true },
      ],
    });
    service = TestBed.inject(MastodonStreamService);
  });

  afterEach(() => {
    service.stop();
    globalThis.fetch = originalFetch;
  });

  /** A fake SSE Response whose body emits the given chunks, then closes. */
  function sse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return {
      ok: true,
      status: 200,
      type: 'basic',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body,
    } as unknown as Response;
  }

  /** Real macrotask wait: native ReadableStream internals are not reliably
   *  zone-patched, so tick()/flushMicrotasks() do not settle the read chain. */
  async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  it('targets the BFF passthrough path (never the homeserver directly)', async () => {
    let seen = '';
    globalThis.fetch = ((input: RequestInfo | URL) => {
      seen = String(input);
      return Promise.resolve(sse([]));
    }) as typeof fetch;

    service.start();
    await flush();

    expect(seen).toBe('/bff/user/mastodon/api/v1/streaming/user');
  });

  it('folds an `update` frame into the updates list', async () => {
    globalThis.fetch = (() => Promise.resolve(sse([
      'event: update\n',
      'data: {"id":"101","content":"hello"}\n\n',
    ]))) as typeof fetch;

    service.start();
    await flush();

    expect(service.updates().map((s) => s.id)).toEqual(['101']);
  });

  it('records a `delete` frame (bare id, not JSON)', async () => {
    globalThis.fetch = (() => Promise.resolve(sse([
      'event: delete\n',
      'data: 202\n\n',
    ]))) as typeof fetch;

    service.start();
    await flush();

    expect(service.deletions()).toEqual(['202']);
  });

  it('IGNORES event types this column has no business acting on', async () => {
    globalThis.fetch = (() => Promise.resolve(sse([
      'event: notification\n',
      'data: {"id":"n1","type":"mention"}\n\n',
      'event: filters_changed\n',
      'data: {}\n\n',
    ]))) as typeof fetch;

    service.start();
    await flush();

    expect(service.updates()).toEqual([]);
    expect(service.deletions()).toEqual([]);
  });

  it('reassembles a frame split ACROSS chunk boundaries', async () => {
    globalThis.fetch = (() => Promise.resolve(sse([
      'event: upd',
      'ate\ndata: {"id":"3',
      '03","content":"split"}\n\n',
    ]))) as typeof fetch;

    service.start();
    await flush();

    expect(service.updates().map((s) => s.id)).toEqual(['303']);
  });

  it('reports UNSUPPORTED when the endpoint redirects away (the live-stack shape)', async () => {
    // mastodon-web:3000 (the Rails process) 301s /api/v1/streaming/** to an
    // absolute external URL; the streaming server is a separate container that
    // nothing routes to. Verified on this stack 2026-08-14.
    globalThis.fetch = (() => Promise.resolve({
      ok: false, status: 0, type: 'opaqueredirect', headers: new Headers(), body: null,
    } as unknown as Response)) as typeof fetch;

    service.start();
    await flush();

    expect(service.status()).toBe('unsupported');
    expect(service.reason()).toContain('redirected away');
  });

  it('reports UNSUPPORTED on a 200 that is not text/event-stream (SPA fallback)', async () => {
    globalThis.fetch = (() => Promise.resolve({
      ok: true, status: 200, type: 'basic',
      headers: new Headers({ 'content-type': 'text/html' }),
      body: new ReadableStream(),
    } as unknown as Response)) as typeof fetch;

    service.start();
    await flush();

    expect(service.status()).toBe('unsupported');
    expect(service.reason()).toContain('text/html');
  });

  it('reports UNSUPPORTED on a non-2xx and does NOT retry it', async () => {
    let attempts = 0;
    globalThis.fetch = (() => {
      attempts++;
      return Promise.resolve({
        ok: false, status: 503, type: 'basic', headers: new Headers(), body: null,
      } as unknown as Response);
    }) as typeof fetch;

    service.start();
    await flush();
    // A second start() must not re-attempt: the conclusion is terminal, and
    // retrying costs a request per attempt to learn the same thing.
    service.start();
    await flush();

    expect(service.status()).toBe('unsupported');
    expect(attempts).toBe(1);
  });

  it('stop() does NOT erase an `unsupported` conclusion', async () => {
    globalThis.fetch = (() => Promise.resolve({
      ok: false, status: 404, type: 'basic', headers: new Headers(), body: null,
    } as unknown as Response)) as typeof fetch;

    service.start();
    await flush();
    service.stop();

    expect(service.status()).toBe('unsupported');
  });
});
