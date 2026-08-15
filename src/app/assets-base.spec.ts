import { assetsAnchor, assetsBaseFrom, resolveAssetsBase } from './assets-base';
import { ORG_DEFAULT_ASSET } from './preferences.service';
import { VN_MANIFEST_URL, VN_SCENES_BASE } from './vn/scene.service';

/** Any absolute URL (has a scheme). The karma harness rewrites
 *  `import.meta.url` to a `file://` source URL; the shipped native-federation
 *  bundle keeps the real `https://` chunk URL. Either way the point of the
 *  assertion is the same: NOT the bare relative string. */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The regression guard for the FEDERATED 404s the operator hit on 2026-08-14:
 * `https://localhost:8488/assets/vn/scenes/scenes.json` and
 * `https://localhost:8488/assets/mastodon-appearance-default.json` both 404,
 * because these asset bases were bare relative strings resolved against the
 * SHELL document rather than against this remote's own module chunk.
 */
describe('assets-base', () => {
  // The shell mounts this remote at /social/mastodon WITHOUT a trailing slash,
  // so the document's directory is /social/ — one level ABOVE the remote.
  const SHELL_DOCUMENT = 'https://mesh.example/social/mastodon';
  // The chunk this module is bundled into is always served from the remote's
  // own mount, in either host.
  const MODULE_CHUNK = 'https://mesh.example/social/mastodon/chunk-ABC12345.js';
  const STANDALONE_CHUNK = 'https://mastodon.mesh.example/chunk-ABC12345.js';

  it('anchors on the MODULE chunk, not the document — the federated 404', () => {
    expect(assetsBaseFrom(MODULE_CHUNK, 'assets/vn/scenes/'))
      .toBe('https://mesh.example/social/mastodon/assets/vn/scenes/');

    // What the OLD bare-string code did: resolved against the shell document
    // and landed a directory too high — exactly the observed 404 path.
    expect(new URL('assets/vn/scenes/', SHELL_DOCUMENT).href)
      .toBe('https://mesh.example/social/assets/vn/scenes/');
    expect(assetsBaseFrom(MODULE_CHUNK, 'assets/vn/scenes/'))
      .not.toBe(new URL('assets/vn/scenes/', SHELL_DOCUMENT).href);
  });

  it('still resolves inside the remote when it runs STANDALONE at the origin root', () => {
    expect(assetsBaseFrom(STANDALONE_CHUNK, 'assets/vn/scenes/'))
      .toBe('https://mastodon.mesh.example/assets/vn/scenes/');
  });

  it('falls back to the bare relative path when the anchor is unusable', () => {
    expect(assetsBaseFrom('not a url', 'assets/vn/scenes/')).toBe('assets/vn/scenes/');
  });

  it('takes its anchor from the module graph, not from the HTML document', () => {
    const anchor = assetsAnchor();
    expect(anchor).toMatch(ABSOLUTE_URL);
    // Equality with the document would mean the resolver had fallen back to
    // document.baseURI — precisely the defect.
    expect(anchor).not.toBe(document.baseURI);
    expect(resolveAssetsBase('assets/vn/scenes/'))
      .not.toBe(new URL('assets/vn/scenes/', document.baseURI).href);
  });

  describe('the two bases that 404d live', () => {
    it('VN_SCENES_BASE / VN_MANIFEST_URL are absolute, never document-relative', () => {
      expect(VN_SCENES_BASE).toMatch(ABSOLUTE_URL);
      expect(VN_SCENES_BASE).not.toBe('assets/vn/scenes/');
      expect(VN_SCENES_BASE.endsWith('assets/vn/scenes/')).toBeTrue();
      expect(VN_MANIFEST_URL).toBe(`${VN_SCENES_BASE}scenes.json`);
      expect(VN_MANIFEST_URL).not.toBe('assets/vn/scenes/scenes.json');
    });

    it('ORG_DEFAULT_ASSET is absolute, never document-relative', () => {
      expect(ORG_DEFAULT_ASSET).toMatch(ABSOLUTE_URL);
      expect(ORG_DEFAULT_ASSET).not.toBe('assets/mastodon-appearance-default.json');
      expect(ORG_DEFAULT_ASSET.endsWith('assets/mastodon-appearance-default.json')).toBeTrue();
    });
  });
});
