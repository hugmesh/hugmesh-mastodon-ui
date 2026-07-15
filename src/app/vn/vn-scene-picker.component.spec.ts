import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VnScenePickerComponent } from './vn-scene-picker.component';
import { SceneService, VnSceneManifest } from './scene.service';
import {
  AppearancePreferences,
  PREFS_STORAGE_KEY,
  PreferencesService,
  durableKeyFor,
} from '../preferences.service';

const MANIFEST: VnSceneManifest = {
  schemaVersion: 1,
  scenes: [
    { id: 'vn_scene_bedroom', displayName: 'Bedroom', file: 'vn_scene_bedroom.svg', tags: [] },
    { id: 'vn_scene_cafe', displayName: 'Café', file: 'vn_scene_cafe.svg', tags: [] },
    { id: 'vn_scene_park', displayName: 'Park', file: 'vn_scene_park.svg', tags: [] },
  ],
  props: [
    { id: 'vn_prop_lamp', displayName: 'Lamp', file: 'vn_prop_lamp.svg' },
    { id: 'vn_prop_books', displayName: 'Books', file: 'vn_prop_books.svg' },
    { id: 'vn_prop_radio', displayName: 'Radio', file: 'vn_prop_radio.svg' },
  ],
};

/** Minimal Response stand-in (same shape as the PreferencesService spec). */
function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 404, json: () => Promise.resolve(body) } as unknown as Response;
}

/** Route the REAL PreferencesService's BFF traffic: GETs answer from `routes`,
 *  PUTs succeed — so this spec exercises the genuine persist/sync chokepoint. */
function routedFetch(routes: Record<string, unknown> = {}): jasmine.Spy {
  return spyOn(globalThis, 'fetch').and.callFake(((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') return Promise.resolve(jsonResponse({}));
    const url = String(input);
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return Promise.resolve(jsonResponse(body));
    }
    return Promise.resolve(jsonResponse({}, false));
  }) as typeof fetch);
}

const sceneStub = {
  manifest: () => Promise.resolve(MANIFEST),
  scenes: () => Promise.resolve(MANIFEST.scenes),
  props: () => Promise.resolve(MANIFEST.props),
  assetUrl: (file: string) => `assets/vn/scenes/${file}`,
} as unknown as SceneService;

describe('VnScenePickerComponent (picker persistence)', () => {
  let fixture: ComponentFixture<VnScenePickerComponent>;
  let prefsSvc: PreferencesService;
  let fetchSpy: jasmine.Spy;

  const flush = () => new Promise<void>((r) => setTimeout(r));

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [VnScenePickerComponent],
      providers: [PreferencesService, { provide: SceneService, useValue: sceneStub }],
    }).compileComponents();
    prefsSvc = TestBed.inject(PreferencesService);
    fixture = TestBed.createComponent(VnScenePickerComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function input(testid: string): HTMLInputElement {
    return el().querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;
  }

  function change(testid: string): void {
    const i = input(testid);
    i.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('renders every manifest scene as a thumbnail radio with the saved/default scene checked', async () => {
    fetchSpy = routedFetch();
    await create();
    expect(el().querySelectorAll('.scene-option').length).toBe(3);
    expect(input('vn-scene-vn_scene_bedroom').checked).withContext('built-in default scene').toBeTrue();
    expect(input('vn-scene-vn_scene_cafe').checked).toBeFalse();
    // thumbnails resolve against the shipped asset base
    expect(el().querySelector('.scene-thumb')?.getAttribute('src')).toContain('assets/vn/scenes/');
  });

  it('picking a scene persists through PreferencesService: local apply + versioned localStorage + durable PUT', async () => {
    fetchSpy = routedFetch();
    await create();
    await flush();
    fetchSpy.calls.reset();

    change('vn-scene-vn_scene_cafe');

    // local apply is immediate
    expect(prefsSvc.snapshot().chatVnScene).toBe('vn_scene_cafe');
    expect(input('vn-scene-vn_scene_cafe').checked).toBeTrue();
    // versioned localStorage blob (the service's single persist chokepoint)
    const raw = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY)!) as AppearancePreferences;
    expect(raw.chatVnScene).toBe('vn_scene_cafe');
    // durable BFF sync under the namespaced chat key
    await flush();
    const putCall = fetchSpy.calls.all().find((c) => (c.args[1] as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).withContext('a PUT to /bff/user/preferences was fired').toBeDefined();
    expect(String(putCall!.args[0])).toContain('/bff/user/preferences');
    expect(JSON.parse((putCall!.args[1] as RequestInit).body as string)).toEqual({
      key: 'mastodon.appearance.chat.vnScene',
      value: 'vn_scene_cafe',
    });
    expect(durableKeyFor('chatVnScene')).toBe('mastodon.appearance.chat.vnScene');
  });

  it('prop toggles persist a manifest-ordered comma-joined value under chat.vnProps', async () => {
    fetchSpy = routedFetch();
    await create();
    await flush();
    fetchSpy.calls.reset();

    // Enable out of manifest order: books first, then lamp.
    change('vn-prop-vn_prop_books');
    expect(prefsSvc.snapshot().chatVnProps).toBe('vn_prop_books');
    change('vn-prop-vn_prop_lamp');
    expect(prefsSvc.snapshot().chatVnProps)
      .withContext('normalised to manifest order, not click order')
      .toBe('vn_prop_lamp,vn_prop_books');

    // Toggling one OFF removes only that id.
    change('vn-prop-vn_prop_lamp');
    expect(prefsSvc.snapshot().chatVnProps).toBe('vn_prop_books');
    expect(input('vn-prop-vn_prop_lamp').checked).toBeFalse();
    expect(input('vn-prop-vn_prop_books').checked).toBeTrue();

    await flush();
    const putBodies = fetchSpy.calls
      .all()
      .filter((c) => (c.args[1] as RequestInit | undefined)?.method === 'PUT')
      .map((c) => JSON.parse((c.args[1] as RequestInit).body as string) as { key: string; value: string });
    expect(putBodies.every((b) => b.key === 'mastodon.appearance.chat.vnProps')).toBeTrue();
    expect(putBodies[putBodies.length - 1].value).toBe('vn_prop_books');
  });

  it('a reload restores the saved scene + props from the versioned localStorage key', async () => {
    fetchSpy = routedFetch();
    await create();
    change('vn-scene-vn_scene_park');
    change('vn-prop-vn_prop_radio');

    // Simulate a reload: fresh injector + fresh component over the same storage.
    fixture.destroy();
    TestBed.resetTestingModule();
    await create();

    expect(prefsSvc.snapshot().chatVnScene).toBe('vn_scene_park');
    expect(input('vn-scene-vn_scene_park').checked).toBeTrue();
    expect(input('vn-prop-vn_prop_radio').checked).toBeTrue();
    expect(input('vn-prop-vn_prop_lamp').checked).toBeFalse();
  });

  it('hydrates a scene saved on ANOTHER device from GET /bff/user/preferences (server wins)', async () => {
    fetchSpy = routedFetch({
      '/bff/user/preferences': {
        'mastodon.appearance.chat.vnScene': 'vn_scene_cafe',
        'mastodon.appearance.chat.vnProps': 'vn_prop_books',
      },
    });
    await create();
    await flush();
    fixture.detectChanges();

    expect(prefsSvc.snapshot().chatVnScene).toBe('vn_scene_cafe');
    expect(input('vn-scene-vn_scene_cafe').checked).toBeTrue();
    expect(input('vn-prop-vn_prop_books').checked).toBeTrue();
  });

  it('refuses to enable a 17th prop, announcing the limit instead of silently dropping one', async () => {
    fetchSpy = routedFetch();
    await create();
    // Seed 16 already-enabled ids straight through the service (the cap counts
    // ENABLED ids, not manifest membership — a stale pref may carry old ids).
    const sixteen = Array.from({ length: 16 }, (_, i) => `vn_prop_old_${i}`).join(',');
    prefsSvc.hydrate({ chatVnProps: sixteen });
    fixture.detectChanges();

    change('vn-prop-vn_prop_lamp');
    await flush();
    fixture.detectChanges();

    // The pref is unchanged and the refusal is announced WITHOUT "Applied".
    expect(prefsSvc.snapshot().chatVnProps).toBe(sixteen);
    const live = el().querySelector('[data-testid="vn-picker-announcement"]')!;
    expect(live.textContent).toContain('Prop limit reached');
    expect(live.textContent).not.toContain('Applied');

    // Toggling one OFF still works at the cap.
    prefsSvc.hydrate({ chatVnProps: `vn_prop_lamp,${sixteen}`.split(',').slice(0, 16).join(',') });
    fixture.detectChanges();
    change('vn-prop-vn_prop_lamp');
    expect(prefsSvc.snapshot().chatVnProps).not.toContain('vn_prop_lamp');
  });

  it('fails soft to an honest empty state when the manifest is unreachable', async () => {
    fetchSpy = routedFetch();
    TestBed.configureTestingModule({
      imports: [VnScenePickerComponent],
      providers: [
        PreferencesService,
        {
          provide: SceneService,
          useValue: {
            manifest: () => Promise.resolve({ schemaVersion: 1, scenes: [], props: [] }),
            assetUrl: (f: string) => f,
          } as unknown as SceneService,
        },
      ],
    });
    fixture = TestBed.createComponent(VnScenePickerComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    expect(el().querySelectorAll('.scene-option').length).toBe(0);
    expect(el().textContent).toContain('Scenes are unavailable right now.');
  });
});
