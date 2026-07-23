import { TestBed } from '@angular/core/testing';
import {
  PreferencesService,
  PREFS_STORAGE_KEY,
  ORG_DEFAULT_LOCAL_KEY,
  BUILTIN_DEFAULT,
  AppearancePreferences,
  durableKeyFor,
} from './preferences.service';

/** A `.hug-mastodon` remote root the service should style; appended to the live
 *  document so document.querySelectorAll finds it (matches the timeline column). */
function makeRoot(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'hug-mastodon';
  document.body.appendChild(el);
  return el;
}

describe('PreferencesService', () => {
  let root: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    document.querySelectorAll('.hug-mastodon').forEach((n) => n.remove());
    root = makeRoot();
  });

  afterEach(() => {
    localStorage.clear();
    document.querySelectorAll('.hug-mastodon').forEach((n) => n.remove());
  });

  function create(): PreferencesService {
    TestBed.configureTestingModule({ providers: [PreferencesService] });
    return TestBed.inject(PreferencesService);
  }

  it('starts at the built-in default when nothing is saved and not customised', () => {
    const svc = create();
    expect(svc.snapshot().theme).toBe(BUILTIN_DEFAULT.theme);
    expect(svc.isCustomised()).toBeFalse();
  });

  it('selecting an option sets the expected data attribute on the remote root', () => {
    const svc = create();
    svc.set('layout', 'multi');
    expect(root.getAttribute('data-mastodon-layout')).toBe('multi');
    svc.set('mediaCorners', 'square');
    expect(root.getAttribute('data-mastodon-corners')).toBe('square');
  });

  it('selecting a text size sets the --mastodon-text-size custom property', () => {
    const svc = create();
    svc.set('textSize', 'xl');
    expect(root.style.getPropertyValue('--mastodon-text-size')).toBe('1.25rem');
  });

  it('square media corners zero out the --mastodon-media-radius custom property', () => {
    const svc = create();
    svc.set('mediaCorners', 'square');
    expect(root.style.getPropertyValue('--mastodon-media-radius')).toBe('0');
  });

  it('persists a choice to a versioned localStorage key', () => {
    const svc = create();
    svc.set('theme', 'pastel-sky');
    const raw = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY)!) as AppearancePreferences;
    expect(raw.theme).toBe('pastel-sky');
  });

  it('reload restores the saved choice and re-applies it to a fresh root', () => {
    const first = create();
    first.set('theme', 'mono');
    first.set('density', 'compact');

    // Simulate a reload: brand-new service instance + brand-new root.
    document.querySelectorAll('.hug-mastodon').forEach((n) => n.remove());
    const root2 = makeRoot();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [PreferencesService] });
    const second = TestBed.inject(PreferencesService);

    expect(second.snapshot().theme).toBe('mono');
    expect(second.snapshot().density).toBe('compact');
    expect(second.isCustomised()).toBeTrue();
    expect(root2.getAttribute('data-mastodon-theme')).toBe('mono');
    expect(root2.getAttribute('data-mastodon-density')).toBe('compact');
  });

  it('the dyslexia-friendly font option sets the font data attribute', () => {
    const svc = create();
    svc.set('font', 'dyslexic');
    expect(root.getAttribute('data-mastodon-font')).toBe('dyslexic');
  });

  it('high-contrast toggle adds the contrast attribute and removes it when off', () => {
    const svc = create();
    svc.set('highContrast', true);
    expect(root.getAttribute('data-mastodon-contrast')).toBe('on');
    svc.set('highContrast', false);
    expect(root.getAttribute('data-mastodon-contrast')).toBeNull();
  });

  it('reduced-motion toggle adds the motion attribute and removes it when off', () => {
    const svc = create();
    svc.set('reducedMotion', true);
    expect(root.getAttribute('data-mastodon-motion')).toBe('on');
    svc.set('reducedMotion', false);
    expect(root.getAttribute('data-mastodon-motion')).toBeNull();
  });

  it('emits the single-field change on changes$ for the live region', () => {
    const svc = create();
    let last: { key: string; value: unknown } | null = null;
    svc.changes$.subscribe((c) => (last = c));
    svc.set('accent', 'rose');
    expect(last).not.toBeNull();
    expect(last!.key).toBe('accent');
    expect(last!.value).toBe('rose');
  });

  it('a non-customised user inherits the admin/org default', () => {
    const orgDefault: AppearancePreferences = {
      ...BUILTIN_DEFAULT,
      theme: 'pastel-mint',
      layout: 'multi',
    };
    localStorage.setItem(ORG_DEFAULT_LOCAL_KEY, JSON.stringify(orgDefault));
    const svc = create();
    expect(svc.snapshot().theme).toBe('pastel-mint');
    expect(svc.snapshot().layout).toBe('multi');
    expect(svc.isCustomised()).toBeFalse();
  });

  it('a customised user is NOT overwritten by an org default', () => {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...BUILTIN_DEFAULT, theme: 'mono' }));
    localStorage.setItem(ORG_DEFAULT_LOCAL_KEY, JSON.stringify({ ...BUILTIN_DEFAULT, theme: 'pastel-mint' }));
    const svc = create();
    expect(svc.snapshot().theme).withContext('user override wins over org default').toBe('mono');
    expect(svc.isCustomised()).toBeTrue();
  });

  it('setOrgDefault writes the org default and applies it to a non-customised user immediately', () => {
    const svc = create();
    expect(svc.isCustomised()).toBeFalse();
    svc.setOrgDefault({ ...BUILTIN_DEFAULT, accent: 'sky', layout: 'multi' });
    expect(JSON.parse(localStorage.getItem(ORG_DEFAULT_LOCAL_KEY)!).accent).toBe('sky');
    expect(svc.snapshot().layout).toBe('multi');
    expect(root.getAttribute('data-mastodon-layout')).toBe('multi');
  });

  it('setOrgDefault does NOT override a user who already customised', () => {
    const svc = create();
    // Pick a value that DIFFERS from the built-in default so set() actually marks
    // the user as customised (set() short-circuits on a no-op change).
    svc.set('layout', 'multi');
    expect(svc.isCustomised()).withContext('explicit change marks customised').toBeTrue();
    svc.setOrgDefault({ ...BUILTIN_DEFAULT, layout: 'single' });
    expect(svc.snapshot().layout).withContext('customised user keeps their own').toBe('multi');
  });

  it('resetToDefault clears the user prefs and falls back to the org default', () => {
    localStorage.setItem(ORG_DEFAULT_LOCAL_KEY, JSON.stringify({ ...BUILTIN_DEFAULT, theme: 'pastel-rose' }));
    const svc = create();
    svc.set('theme', 'mono');
    expect(svc.isCustomised()).toBeTrue();
    svc.resetToDefault();
    expect(svc.isCustomised()).toBeFalse();
    expect(svc.snapshot().theme).toBe('pastel-rose');
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBeNull();
  });

  it('re-applies to roots that mount AFTER the service (idempotent apply)', () => {
    const svc = create();
    svc.set('theme', 'pastel-sky');
    const lateRoot = makeRoot();
    expect(lateRoot.getAttribute('data-mastodon-theme')).withContext('not styled yet').toBeNull();
    svc.apply();
    expect(lateRoot.getAttribute('data-mastodon-theme')).toBe('pastel-sky');
  });

  it('tolerates malformed JSON in localStorage and falls back to the built-in default', () => {
    localStorage.setItem(PREFS_STORAGE_KEY, '{not valid');
    const svc = create();
    expect(svc.snapshot().theme).toBe(BUILTIN_DEFAULT.theme);
  });

  // ── CHAT THEME group (personal-only) ──────────────────────────────────────
  describe('chat theme group', () => {
    it('ships neutral chat defaults that leave today\'s look untouched', () => {
      const svc = create();
      const s = svc.snapshot();
      expect(s.chatBubbleShape).toBe('rounded');
      expect(s.chatAccentMine).toBe('');
      expect(s.chatAccentTheirs).toBe('');
      expect(s.chatFont).toBe('system');
      expect(s.chatDensity).toBe('cozy');
      expect(s.chatBackground).toBe('none');
      expect(s.vnDialogSkin).toBe('classic');
      // No accent chosen → no --mastodon-chat-accent-* var is ever written.
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-theirs')).toBe('');
    });

    it('applies each chat choice as its data-mastodon-chat-* attribute on the remote root', () => {
      const svc = create();
      svc.set('chatBubbleShape', 'sharp');
      expect(root.getAttribute('data-mastodon-chat-shape')).toBe('sharp');
      svc.set('chatFont', 'mono');
      expect(root.getAttribute('data-mastodon-chat-font')).toBe('mono');
      svc.set('chatDensity', 'compact');
      expect(root.getAttribute('data-mastodon-chat-density')).toBe('compact');
      svc.set('chatBackground', 'stars');
      expect(root.getAttribute('data-mastodon-chat-bg')).toBe('stars');
      svc.set('vnDialogSkin', 'retro');
      expect(root.getAttribute('data-mastodon-chat-vnskin')).toBe('retro');
    });

    it('a valid #rrggbb accent is applied as a CSS var and persisted', () => {
      const svc = create();
      svc.set('chatAccentMine', '#ff0066');
      svc.set('chatAccentTheirs', '#00AAff');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('#ff0066');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-theirs')).toBe('#00AAff');
      const saved = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY)!) as AppearancePreferences;
      expect(saved.chatAccentMine).toBe('#ff0066');
      expect(saved.chatAccentTheirs).toBe('#00AAff');
    });

    it('rejects a non-#rrggbb accent BEFORE it is applied, persisted or synced', () => {
      const svc = create();
      for (const bad of ['red', '#12345', '#1234567', '#12g45x', 'url(javascript:1)', ' #ff0066', '#ff0066;--x:y']) {
        svc.set('chatAccentMine', bad);
      }
      expect(svc.snapshot().chatAccentMine).withContext('never entered the state').toBe('');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).withContext('never written as a var').toBe('');
      expect(localStorage.getItem(PREFS_STORAGE_KEY)).withContext('never persisted').toBeNull();
    });

    it('clearing an accent back to "" removes the CSS var (fallbacks take over)', () => {
      const svc = create();
      svc.set('chatAccentMine', '#ff0066');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('#ff0066');
      svc.set('chatAccentMine', '');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('');
    });

    it('a stored invalid accent (tampered localStorage) is never written as a var', () => {
      localStorage.setItem(
        PREFS_STORAGE_KEY,
        JSON.stringify({ ...BUILTIN_DEFAULT, chatAccentMine: 'url(javascript:1)' }),
      );
      const svc = create();
      expect(svc).toBeTruthy();
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('');
    });

    it('rejects an over-long VN scene id / props list at the set() chokepoint (length caps)', () => {
      const svc = create();
      svc.set('chatVnScene', 'x'.repeat(129)); // cap: 128
      expect(svc.snapshot().chatVnScene).toBe(BUILTIN_DEFAULT.chatVnScene);
      svc.set('chatVnProps', 'p'.repeat(2049)); // cap: 2048
      expect(svc.snapshot().chatVnProps).toBe(BUILTIN_DEFAULT.chatVnProps);
      expect(localStorage.getItem(PREFS_STORAGE_KEY)).withContext('never persisted').toBeNull();
      // …while values inside the caps still apply normally.
      svc.set('chatVnScene', 'vn_scene_cafe');
      expect(svc.snapshot().chatVnScene).toBe('vn_scene_cafe');
    });

    it('chat fields round-trip a reload like every other preference', () => {
      const first = create();
      first.set('chatBubbleShape', 'square');
      first.set('chatAccentMine', '#112233');
      first.set('vnDialogSkin', 'glass');

      document.querySelectorAll('.hug-mastodon').forEach((n) => n.remove());
      const root2 = makeRoot();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [PreferencesService] });
      const second = TestBed.inject(PreferencesService);

      expect(second.snapshot().chatBubbleShape).toBe('square');
      expect(root2.getAttribute('data-mastodon-chat-shape')).toBe('square');
      expect(root2.getAttribute('data-mastodon-chat-vnskin')).toBe('glass');
      expect(root2.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('#112233');
    });

    it('resetChatToDefault restores ONLY the chat group, leaving other choices intact', () => {
      const svc = create();
      svc.set('theme', 'mono');
      svc.set('chatBackground', 'dots');
      svc.set('chatAccentTheirs', '#ff0066');
      svc.resetChatToDefault();
      expect(svc.snapshot().chatBackground).toBe('none');
      expect(svc.snapshot().chatAccentTheirs).toBe('');
      expect(root.getAttribute('data-mastodon-chat-bg')).toBe('none');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-theirs')).toBe('');
      expect(svc.snapshot().theme).withContext('non-chat choice untouched').toBe('mono');
    });

    it('setOrgDefault strips the chat group — chat theming is personal-only, never the org default', () => {
      const svc = create();
      svc.setOrgDefault({
        ...BUILTIN_DEFAULT,
        accent: 'sky',
        chatAccentMine: '#ff0066',
        chatBackground: 'stars',
        vnDialogSkin: 'retro',
      });
      const org = JSON.parse(localStorage.getItem(ORG_DEFAULT_LOCAL_KEY)!) as AppearancePreferences;
      expect(org.accent).withContext('non-chat field kept').toBe('sky');
      expect(org.chatAccentMine).toBe('');
      expect(org.chatBackground).toBe('none');
      expect(org.vnDialogSkin).toBe('classic');
    });

    it('maps chat fields to the namespaced mastodon.appearance.chat.* durable keys', () => {
      expect(durableKeyFor('chatBubbleShape')).toBe('mastodon.appearance.chat.bubbleShape');
      expect(durableKeyFor('chatAccentMine')).toBe('mastodon.appearance.chat.accentMine');
      expect(durableKeyFor('vnDialogSkin')).toBe('mastodon.appearance.chat.vnDialogSkin');
      expect(durableKeyFor('theme')).withContext('original fields stay flat').toBe('mastodon.appearance.theme');
    });
  });

  // ── BFF sync (wired: user-bff-api /bff/user/preferences + admin-bff-api
  //    /bff/mastodon/appearance-default) ─────────────────────────────────────
  describe('BFF sync', () => {
    /** Flush the microtask chain a fetch-based async constructor method runs
     *  through (no real timers involved, so a single macrotask tick drains it). */
    async function flush(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function jsonResponse(body: unknown, ok = true): Response {
      return { ok, status: ok ? 200 : 404, json: async () => body } as Response;
    }

    /** Route a fetch spy by URL suffix; unmatched URLs 404 (so the asset
     *  fallback / other paths behave like an unreachable/unconfigured backend). */
    function routedFetch(routes: Record<string, unknown>): jasmine.Spy {
      return spyOn(globalThis, 'fetch').and.callFake(((input: RequestInfo | URL) => {
        const url = String(input);
        for (const suffix of Object.keys(routes)) {
          if (url.endsWith(suffix)) return Promise.resolve(jsonResponse(routes[suffix]));
        }
        return Promise.resolve(jsonResponse({}, false));
      }) as typeof fetch);
    }

    function createFresh(): PreferencesService {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [PreferencesService] });
      return TestBed.inject(PreferencesService);
    }

    it('hydrates from GET /bff/user/preferences, server winning over localStorage', async () => {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...BUILTIN_DEFAULT, theme: 'mono' }));
      routedFetch({
        '/bff/user/preferences': {
          'mastodon.appearance.theme': 'pastel-mint',
          'mastodon.appearance.highContrast': 'true',
        },
      });
      const svc = createFresh();
      await flush();
      expect(svc.snapshot().theme).toBe('pastel-mint');
      expect(svc.snapshot().highContrast).withContext('boolean-typed, not the "true" string').toBeTrue();
      expect(svc.isCustomised()).toBeTrue();
    });

    it('leaves state untouched when GET /bff/user/preferences has no known keys', async () => {
      routedFetch({ '/bff/user/preferences': {} });
      const svc = createFresh();
      await flush();
      expect(svc.snapshot().theme).toBe(BUILTIN_DEFAULT.theme);
      expect(svc.isCustomised()).toBeFalse();
    });

    it('a fetch failure/offline leaves the already-resolved state untouched', async () => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.reject(new Error('offline')));
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...BUILTIN_DEFAULT, theme: 'mono' }));
      const svc = createFresh();
      await flush();
      expect(svc.snapshot().theme).toBe('mono');
    });

    it('adopts the admin-bff org default ahead of the shipped asset for a non-customised caller', async () => {
      routedFetch({
        '/bff/user/preferences': {},
        '/bff/mastodon/appearance-default': { theme: 'pastel-sky', layout: 'multi' },
      });
      const svc = createFresh();
      await flush();
      expect(svc.snapshot().theme).toBe('pastel-sky');
      expect(svc.snapshot().layout).toBe('multi');
      expect(svc.isCustomised()).toBeFalse();
      expect(JSON.parse(localStorage.getItem(ORG_DEFAULT_LOCAL_KEY)!).theme)
        .withContext('cached locally for an offline reload')
        .toBe('pastel-sky');
    });

    it('does NOT adopt the admin-bff org default for a caller already customised', async () => {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...BUILTIN_DEFAULT, theme: 'mono' }));
      routedFetch({
        '/bff/user/preferences': {},
        '/bff/mastodon/appearance-default': { theme: 'pastel-sky' },
      });
      const svc = createFresh();
      await flush();
      expect(svc.snapshot().theme).withContext('user override wins over the org default').toBe('mono');
    });

    it('an empty admin-bff org default (none configured yet) does not clobber the built-in default', async () => {
      routedFetch({ '/bff/user/preferences': {}, '/bff/mastodon/appearance-default': {} });
      const svc = createFresh();
      await flush();
      expect(svc.snapshot().theme).toBe(BUILTIN_DEFAULT.theme);
    });

    it('set() PUTs the changed field to /bff/user/preferences with the durable key shape', async () => {
      const fetchSpy = routedFetch({ '/bff/user/preferences': {}, '/bff/mastodon/appearance-default': {} });
      const svc = createFresh();
      await flush();
      fetchSpy.calls.reset();
      svc.set('theme', 'mono');
      // Local apply is IMMEDIATE and synchronous — never blocked on the network.
      expect(svc.snapshot().theme).toBe('mono');
      await flush();
      const putCall = fetchSpy.calls.all().find((c) => (c.args[1] as RequestInit | undefined)?.method === 'PUT');
      expect(putCall).withContext('a PUT to /bff/user/preferences was fired').toBeDefined();
      expect(String(putCall!.args[0])).toContain('/bff/user/preferences');
      expect(JSON.parse((putCall!.args[1] as RequestInit).body as string)).toEqual({
        key: 'mastodon.appearance.theme',
        value: 'mono',
      });
    });

    it('set() surfaces a sync failure on syncError WITHOUT reverting the local apply', async () => {
      spyOn(globalThis, 'fetch').and.callFake(((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') return Promise.reject(new Error('network down'));
        return Promise.resolve(jsonResponse({}, false));
      }) as typeof fetch);
      const svc = createFresh();
      await flush();
      svc.set('theme', 'mono');
      expect(svc.snapshot().theme).withContext('applies locally regardless of network state').toBe('mono');
      await flush();
      expect(svc.syncError()).withContext('never a silently-accepted no-op').not.toBeNull();
    });

    it('setOrgDefault() PUTs { prefs } to /bff/admin/mastodon/appearance-default', async () => {
      const fetchSpy = routedFetch({ '/bff/user/preferences': {}, '/bff/mastodon/appearance-default': {} });
      const svc = createFresh();
      await flush();
      fetchSpy.calls.reset();
      const next = { ...BUILTIN_DEFAULT, accent: 'sky' as const };
      svc.setOrgDefault(next);
      await flush();
      const putCall = fetchSpy.calls.all().find((c) => String(c.args[0]).includes('/bff/admin/mastodon/appearance-default'));
      expect(putCall).withContext('a PUT to the admin-bff endpoint was fired').toBeDefined();
      expect((putCall!.args[1] as RequestInit).method).toBe('PUT');
      expect(JSON.parse((putCall!.args[1] as RequestInit).body as string)).toEqual({ prefs: next });
    });

    // ── chat theme group over the same wire ─────────────────────────────────
    it('hydrates chat fields from GET /bff/user/preferences via the mastodon.appearance.chat.* keys', async () => {
      routedFetch({
        '/bff/user/preferences': {
          'mastodon.appearance.chat.bubbleShape': 'sharp',
          'mastodon.appearance.chat.accentMine': '#123abc',
          'mastodon.appearance.chat.vnDialogSkin': 'glass',
        },
      });
      const svc = createFresh();
      await flush();
      expect(svc.snapshot().chatBubbleShape).toBe('sharp');
      expect(svc.snapshot().chatAccentMine).toBe('#123abc');
      expect(svc.snapshot().vnDialogSkin).toBe('glass');
      expect(root.getAttribute('data-mastodon-chat-shape')).toBe('sharp');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('#123abc');
      expect(svc.isCustomised()).toBeTrue();
    });

    it('ignores a server-delivered accent that is not strict #rrggbb (never reaches a CSS var)', async () => {
      routedFetch({
        '/bff/user/preferences': {
          'mastodon.appearance.chat.accentMine': 'url(javascript:alert(1))',
          'mastodon.appearance.chat.accentTheirs': '#ff00',
        },
      });
      const svc = createFresh();
      await flush();
      expect(svc.snapshot().chatAccentMine).toBe('');
      expect(svc.snapshot().chatAccentTheirs).toBe('');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-theirs')).toBe('');
    });

    it('ignores a server-delivered VN scene/props value past the length caps (fail-soft hydrate)', async () => {
      routedFetch({
        '/bff/user/preferences': {
          'mastodon.appearance.chat.vnScene': 's'.repeat(200),
          'mastodon.appearance.chat.vnProps': 'p'.repeat(3000),
        },
      });
      const svc = createFresh();
      await flush();
      expect(svc.snapshot().chatVnScene).toBe(BUILTIN_DEFAULT.chatVnScene);
      expect(svc.snapshot().chatVnProps).toBe(BUILTIN_DEFAULT.chatVnProps);
    });

    it('set() PUTs a chat field under its namespaced mastodon.appearance.chat.* key', async () => {
      const fetchSpy = routedFetch({ '/bff/user/preferences': {}, '/bff/mastodon/appearance-default': {} });
      const svc = createFresh();
      await flush();
      fetchSpy.calls.reset();
      svc.set('chatAccentTheirs', '#00ff99');
      await flush();
      const putCall = fetchSpy.calls.all().find((c) => (c.args[1] as RequestInit | undefined)?.method === 'PUT');
      expect(putCall).withContext('a PUT to /bff/user/preferences was fired').toBeDefined();
      expect(JSON.parse((putCall!.args[1] as RequestInit).body as string)).toEqual({
        key: 'mastodon.appearance.chat.accentTheirs',
        value: '#00ff99',
      });
    });

    it('an invalid accent never fires a PUT (rejected before the sync leg)', async () => {
      const fetchSpy = routedFetch({ '/bff/user/preferences': {}, '/bff/mastodon/appearance-default': {} });
      const svc = createFresh();
      await flush();
      fetchSpy.calls.reset();
      svc.set('chatAccentTheirs', 'not-a-colour');
      await flush();
      const putCall = fetchSpy.calls.all().find((c) => (c.args[1] as RequestInit | undefined)?.method === 'PUT');
      expect(putCall).toBeUndefined();
    });

    it('setOrgDefault() PUTs a chat-stripped prefs blob to the admin endpoint', async () => {
      const fetchSpy = routedFetch({ '/bff/user/preferences': {}, '/bff/mastodon/appearance-default': {} });
      const svc = createFresh();
      await flush();
      fetchSpy.calls.reset();
      svc.setOrgDefault({ ...BUILTIN_DEFAULT, accent: 'sky', chatAccentMine: '#ff0066', vnDialogSkin: 'retro' });
      await flush();
      const putCall = fetchSpy.calls.all().find((c) => String(c.args[0]).includes('/bff/admin/mastodon/appearance-default'));
      expect(putCall).toBeDefined();
      const sent = JSON.parse((putCall!.args[1] as RequestInit).body as string) as { prefs: AppearancePreferences };
      expect(sent.prefs.accent).toBe('sky');
      expect(sent.prefs.chatAccentMine).withContext('personal-only group stripped from the org default').toBe('');
      expect(sent.prefs.vnDialogSkin).toBe('classic');
    });

    it('setOrgDefault() surfaces a sync failure on syncError without reverting the local + cached apply', async () => {
      spyOn(globalThis, 'fetch').and.callFake(((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') return Promise.reject(new Error('network down'));
        return Promise.resolve(jsonResponse({}, false));
      }) as typeof fetch);
      const svc = createFresh();
      await flush();
      svc.setOrgDefault({ ...BUILTIN_DEFAULT, accent: 'sky' });
      expect(svc.snapshot().accent).withContext('applies locally regardless of network state').toBe('sky');
      await flush();
      expect(svc.syncError()).withContext('never a silently-accepted no-op').not.toBeNull();
    });
  });
});
