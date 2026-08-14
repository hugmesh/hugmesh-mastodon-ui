import { Injectable, inject, signal } from '@angular/core';

import { BFF_BASE_URL, MASTODON_PROXY_MODE, Status } from './mastodon.service';

/**
 * Parse one raw SSE wire line into a `{name, value}` field per the SSE spec:
 * split on the FIRST colon, and strip AT MOST ONE leading space from the value
 * (the spec-mandated allowance — a compliant writer may or may not include it).
 * Returns `null` for a blank line (event terminator), a comment line (starts
 * with `:`), or a line with no colon at all.
 *
 * Deliberately NOT an exact-prefix match like `line.startsWith('data: ')`:
 * different servers differ on the optional space (Spring WebFlux emits `data:`
 * with none, Mastodon's streaming server emits `data: ` with one), and an exact
 * check against the wrong one matches ZERO real events while looking correct.
 * That exact bug shipped once in the host shell's notification stream.
 */
export function parseSseField(line: string): { name: string; value: string } | null {
  if (line === '' || line.startsWith(':')) return null;
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const name = line.slice(0, colon);
  let value = line.slice(colon + 1);
  if (value.startsWith(' ')) value = value.slice(1);
  return { name, value };
}

/** What the stream is actually doing, so the UI can say so rather than imply
 *  liveness it does not have. */
export type StreamStatus =
  /** Not started (or stopped). */
  | 'idle'
  /** The handshake is in flight. */
  | 'connecting'
  /** Receiving `text/event-stream` right now. */
  | 'live'
  /** The stream dropped and we are waiting to retry. */
  | 'reconnecting'
  /** This deployment does not serve the streaming endpoint — see `reason`. The
   *  caller must fall back to polling and SAY so. */
  | 'unsupported';

/**
 * LIVE Mastodon timeline updates over the streaming API's SSE transport.
 *
 * This is a REAL stream, not an invented one: Mastodon's streaming API serves
 * `GET /api/v1/streaming/user` as `text/event-stream`, and the user-bff-api
 * hsproxy forwards `/bff/user/mastodon/**` verbatim with the server-held
 * homeserver token injected — `MastodonProxyController`'s own javadoc calls out
 * that "Streaming (/api/v1/streaming/**) passes through verbatim via
 * HsReverseProxy", and `HsReverseProxy` streams the response as an unbuffered
 * `Flux<DataBuffer>` with no read-timeout cap. The fe-gateway sets
 * `proxy_buffering off` for `/bff/**`, so frames are not held back at the edge
 * either.
 *
 * WHAT CAN STILL GO WRONG, and why `unsupported` exists: whether that path
 * reaches a streaming server is a DEPLOYMENT question. On the local stack the
 * proxy's upstream is `mastodon-web:3000` (the Rails process), which does not
 * serve the streaming API and answers `/api/v1/streaming/**` with a 301 to an
 * absolute external URL; the streaming server is a separate container. So the
 * connect attempt must be able to conclude "this deployment does not serve it"
 * and hand back to polling, rather than silently going quiet — a timeline that
 * has stopped updating and a timeline that has no live transport look identical
 * to a user, and only one of them is worth reporting to an operator.
 *
 * Detection rules, in order:
 *   - a redirect (the proxy forwards the upstream 301 rather than following it,
 *     and the target is cross-origin, which CSP `connect-src 'self'` would block
 *     anyway) ⇒ unsupported;
 *   - a non-2xx ⇒ unsupported (401 included: the user has no streaming grant);
 *   - a 2xx whose content-type is not `text/event-stream` ⇒ unsupported (this is
 *     the SPA-fallback / HTML-error-page shape).
 * Only after all three pass do we read frames and report `live`.
 */
@Injectable({ providedIn: 'root' })
export class MastodonStreamService {
  /** The user stream: home timeline + notifications for the authenticated
   *  caller. `stream=user` is carried in the path per the streaming API. */
  private static readonly STREAM_PATH = '/api/v1/streaming/user';
  private static readonly RECONNECT_MS = 5_000;

  private readonly bffBaseUrl = inject(BFF_BASE_URL);
  private readonly proxyMode = inject(MASTODON_PROXY_MODE);

  readonly status = signal<StreamStatus>('idle');
  /** Why the stream is `unsupported`, verbatim from what we observed. Empty in
   *  every other state. */
  readonly reason = signal('');

  /** Statuses that arrived on the stream, newest last. A consumer drains this
   *  by reacting to it; the service never mutates the timeline itself. */
  readonly updates = signal<Status[]>([]);
  /** Ids of statuses the server says were DELETED while we were connected. */
  readonly deletions = signal<string[]>([]);

  private controller: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.controller) return;
    // TERMINAL: once we have established that this deployment does not serve
    // the stream, re-attempting costs a request per try to learn the same
    // thing. The caller is already polling and already saying why.
    if (this.status() === 'unsupported') return;
    this.controller = new AbortController();
    this.status.set('connecting');
    void this.consume();
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // 'unsupported' is a CONCLUSION about the deployment, not a connection
    // state — stopping must not erase it, or the caller would retry forever.
    if (this.status() !== 'unsupported') this.status.set('idle');
  }

  /** The stream endpoint. Goes through the BFF hsproxy in the default proxy
   *  mode; the direct-homeserver escape hatch has no token and so cannot
   *  stream, which the caller sees as an `unsupported` 401. */
  private endpoint(): string {
    return `${this.bffBaseUrl}/bff/user/mastodon${MastodonStreamService.STREAM_PATH}`;
  }

  private async consume(): Promise<void> {
    const signal = this.controller?.signal;
    if (!signal) return;

    let response: Response;
    try {
      response = await fetch(this.endpoint(), {
        credentials: this.proxyMode ? 'include' : 'omit',
        headers: { Accept: 'text/event-stream' },
        // A redirect here is diagnostic, not something to chase: the upstream
        // 301 points at an absolute external URL that CSP connect-src 'self'
        // blocks. 'manual' surfaces it as an opaqueredirect we can classify.
        redirect: 'manual',
        signal,
      });
    } catch (err) {
      // Aborted by stop() — say nothing. Any other error is a genuine failure.
      if (signal.aborted) return;
      this.unsupported(`the streaming endpoint could not be reached (${String(err)})`);
      return;
    }

    if (response.type === 'opaqueredirect' || response.status === 0) {
      this.unsupported(
        'the streaming endpoint redirected away from this origin — the BFF proxy\'s '
        + 'Mastodon upstream does not serve /api/v1/streaming',
      );
      return;
    }
    if (!response.ok) {
      this.unsupported(`the streaming endpoint answered HTTP ${response.status}`);
      return;
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      this.unsupported(
        `the streaming endpoint answered HTTP 200 with content-type "${contentType || 'none'}" `
        + 'instead of text/event-stream',
      );
      return;
    }
    if (!response.body) {
      this.unsupported('the streaming response carried no readable body');
      return;
    }

    this.status.set('live');
    this.reason.set('');
    await this.readFrames(response.body.getReader());
  }

  /** Read the SSE wire until it closes, dispatching each complete frame. */
  private async readFrames(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    // The streaming API splits one logical event across an `event:` line and a
    // `data:` line, so the event NAME has to be carried between lines.
    let eventName = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          this.scheduleReconnect();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer.
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
          const field = parseSseField(line);
          if (!field) {
            // Blank line terminates the frame; a comment is a keepalive.
            if (line === '') eventName = '';
            continue;
          }
          if (field.name === 'event') { eventName = field.value; continue; }
          if (field.name === 'data') { this.dispatch(eventName, field.value); }
        }
      }
    } catch {
      // Reader errored (network drop, or stop() aborted the request).
      if (this.controller) this.scheduleReconnect();
    }
  }

  /** Turn one `event:`/`data:` pair into a timeline effect. Unknown event types
   *  are IGNORED rather than guessed at — the streaming API carries several
   *  (`notification`, `filters_changed`, `announcement`, …) that this column has
   *  no business acting on. */
  private dispatch(eventName: string, data: string): void {
    if (eventName === 'delete') {
      // `delete` carries a bare status id, not JSON.
      const id = data.trim();
      if (id) this.deletions.update((ids) => [...ids, id]);
      return;
    }
    if (eventName !== 'update') return;
    try {
      const status = JSON.parse(data) as Status;
      if (status?.id) this.updates.update((list) => [...list, status]);
    } catch {
      // Malformed frame — skip it rather than tearing the stream down.
    }
  }

  private scheduleReconnect(): void {
    if (!this.controller) return;
    this.status.set('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.consume();
    }, MastodonStreamService.RECONNECT_MS);
  }

  /** Conclude that this deployment does not serve the stream. Terminal: we stop
   *  and do NOT retry, because every retry would produce the same answer while
   *  costing a request. The caller polls instead, and says why. */
  private unsupported(reason: string): void {
    this.reason.set(reason);
    this.controller?.abort();
    this.controller = null;
    this.status.set('unsupported');
  }
}
