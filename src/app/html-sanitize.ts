import DOMPurify from 'dompurify';

/**
 * Keep `target` and `rel` on anchors long enough for the reverse-tabnabbing
 * guard below to see them. DOMPurify 3.x strips BOTH attributes from `<a>`
 * during its built-in attribute pass — BEFORE `afterSanitizeAttributes` runs and
 * even though both are in our ALLOWED_ATTR — which silently broke the guard: a
 * target-link came out with NEITHER a target NOR a rel, and an incoming
 * `rel="nofollow"` was lost so the guard could not augment it. Force-keeping
 * them on `<a>` restores the intended new-tab UX (Mastodon emits target="_blank")
 * AND lets the guard preserve existing rel tokens while adding the protective
 * ones. Scoped to anchors; every kept target is neutralised by the rel the next
 * hook forces on, and rel itself carries no script/URI surface. */
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (node.nodeName === 'A' && (data.attrName === 'target' || data.attrName === 'rel')) {
    data.forceKeepAttr = true;
  }
});

/**
 * Reverse-tabnabbing guard (MIRRORS snapdragon-wiki-ui's markdown.ts hook): any
 * <a> that opens a new browsing context (a `target` attribute, esp.
 * target="_blank" — which Mastodon emits on mention/hashtag/link anchors) must
 * carry rel="noopener noreferrer" so the opened page cannot reach back via
 * window.opener. Registered once at module load so EVERY sanitizeContentHtml()
 * call below is covered without widening the allow-list; existing rel tokens are
 * preserved + augmented. */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node.hasAttribute('target')) {
    const tokens = new Set((node.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean));
    tokens.add('noopener');
    tokens.add('noreferrer');
    node.setAttribute('rel', Array.from(tokens).join(' '));
  }
});

/**
 * Sanitize SERVER-RENDERED / federated content HTML before it is bound into the
 * page view via `[innerHTML]`.
 *
 * Mastodon toot bodies, account bios (`note`), and custom profile field values
 * are remote/federated HTML authored by a HOSTILE-POSSIBLE upstream homeserver
 * or actor. They MUST NOT be trusted. We run every such string through DOMPurify
 * with a conservative allow-list at the browser boundary (defence-in-depth, in
 * addition to Angular's own binding sanitizer) so a compromised or malicious
 * upstream can never inject script / event handlers / `javascript:` URLs into
 * the reader's DOM (A03 / CWE-79).
 *
 * The allow-list MIRRORS snapdragon-wiki-ui's `sanitizeContentHtml`:
 *  - NO script / iframe / svg / object / embed tags.
 *  - ALLOWED_ATTR carries NO `on*` event handlers.
 *  - ALLOWED_URI_REGEXP restricts hrefs/srcs to http(s) so `javascript:` and
 *    `data:` URIs are blocked.
 * It additionally permits the small set of structural tags Mastodon emits for
 * toots/bios (span / img / strong / em / blockquote / lists / code / pre) plus
 * the `class` attribute Mastodon uses for mentions/hashtags styling.
 */
export function sanitizeContentHtml(html: string): string {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: [
      'a', 'img', 'p', 'span', 'br', 'strong', 'em', 'blockquote',
      'ul', 'ol', 'li', 'code', 'pre',
    ],
    ALLOWED_ATTR: ['href', 'rel', 'target', 'src', 'alt', 'title', 'class'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}
