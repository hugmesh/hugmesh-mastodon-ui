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

  it('returns an empty string for null/undefined input', () => {
    expect(sanitizeContentHtml(null as unknown as string)).toBe('');
    expect(sanitizeContentHtml(undefined as unknown as string)).toBe('');
  });
});
