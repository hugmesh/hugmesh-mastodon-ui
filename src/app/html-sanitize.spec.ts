import { sanitizeContentHtml } from './html-sanitize';

describe('sanitizeContentHtml (federated-HTML render boundary)', () => {
  it('strips a <script> payload', () => {
    const html = sanitizeContentHtml('<p>hi</p><script>alert(1)</script>');
    expect(html).toContain('hi');
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('removes an onerror= event handler from an <img>', () => {
    const html = sanitizeContentHtml('<img src=x onerror=alert(1)>');
    // The onerror handler must be gone (the <img> may or may not survive, but
    // if it does it must carry no inline event handler).
    expect(html.toLowerCase()).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('drops a javascript: href so the scheme never reaches the DOM', () => {
    const html = sanitizeContentHtml('<a href="javascript:alert(1)">x</a>');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).not.toContain('alert(1)');
  });

  it('preserves a benign <p> paragraph', () => {
    const html = sanitizeContentHtml('<p>hello world</p>');
    expect(html).toContain('<p>hello world</p>');
  });

  it('preserves a benign https anchor with its href', () => {
    const html = sanitizeContentHtml('<a href="https://x">link</a>');
    expect(html).toContain('href="https://x"');
    expect(html).toContain('link');
  });

  it('forces rel="noopener noreferrer" on a target="_blank" link (reverse-tabnabbing) while keeping the anchor', () => {
    const html = sanitizeContentHtml('<a href="https://example.test" target="_blank">site</a>');
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain('site');
    const rel = /rel="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });

  it('augments (does not clobber) an existing rel token on a target link', () => {
    const html = sanitizeContentHtml(
      '<a href="https://example.test" target="_blank" rel="nofollow">site</a>',
    );
    const rel = /rel="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(rel).toContain('nofollow');
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });

  it('does not add rel to an anchor that has no target', () => {
    const html = sanitizeContentHtml('<a href="https://example.test">site</a>');
    expect(html).not.toContain('rel=');
  });

  it('preserves a Mastodon mention anchor (class + custom-emoji <img>) verbatim-enough to render', () => {
    // Mastodon mentions carry a class; custom emoji are <img class="emojione">.
    const html = sanitizeContentHtml(
      '<p><span class="h-card"><a href="https://m.test/@bob" class="u-url mention">@bob</a></span> ' +
        'hi <img src="https://m.test/emoji/wave.png" class="emojione" alt=":wave:"></p>',
    );
    expect(html).toContain('class="u-url mention"');
    expect(html).toContain('href="https://m.test/@bob"');
    expect(html).toContain('@bob');
    expect(html).toContain('class="emojione"');
    expect(html).toContain('alt=":wave:"');
  });

  it('returns an empty string for null/undefined input', () => {
    expect(sanitizeContentHtml(null as unknown as string)).toBe('');
    expect(sanitizeContentHtml(undefined as unknown as string)).toBe('');
  });
});
