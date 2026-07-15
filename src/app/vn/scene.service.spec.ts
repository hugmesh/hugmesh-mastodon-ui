import { TestBed } from '@angular/core/testing';
import {
  MAX_VN_MANIFEST_ENTRIES,
  SceneService,
  VN_MANIFEST_URL,
  VN_SCENES_BASE,
  VnSceneManifest,
} from './scene.service';

/** Minimal Response stand-in (same shape the PreferencesService spec uses). */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const MANIFEST: VnSceneManifest = {
  schemaVersion: 1,
  scenes: [
    { id: 'vn_scene_bedroom', displayName: 'Bedroom', file: 'vn_scene_bedroom.svg', tags: ['indoor'] },
    { id: 'vn_scene_cafe', displayName: 'Café', file: 'vn_scene_cafe.svg', tags: ['indoor'] },
  ],
  props: [
    { id: 'vn_prop_lamp', displayName: 'Lamp', file: 'vn_prop_lamp.svg' },
    { id: 'vn_prop_books', displayName: 'Books', file: 'vn_prop_books.svg' },
  ],
};

describe('SceneService', () => {
  function create(): SceneService {
    TestBed.configureTestingModule({ providers: [SceneService] });
    return TestBed.inject(SceneService);
  }

  it('loads and parses the shipped manifest', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse(MANIFEST));
    const svc = create();
    const manifest = await svc.manifest();
    expect(fetchSpy).toHaveBeenCalledWith(VN_MANIFEST_URL);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.scenes.length).toBe(2);
    expect(manifest.props.length).toBe(2);
  });

  it('fetches the manifest AT MOST once — every caller shares the cached load', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse(MANIFEST));
    const svc = create();
    const [a, b] = await Promise.all([svc.manifest(), svc.scenes()]);
    await svc.props();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a.scenes).toEqual(b as never);
  });

  it('resolves a known scene id to its shipped asset URL', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse(MANIFEST));
    const svc = create();
    expect(await svc.sceneUrl('vn_scene_cafe')).toBe(`${VN_SCENES_BASE}vn_scene_cafe.svg`);
    expect(await svc.propUrl('vn_prop_lamp')).toBe(`${VN_SCENES_BASE}vn_prop_lamp.svg`);
  });

  it('resolves an unknown (stale-preference) id to null, never a broken URL', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse(MANIFEST));
    const svc = create();
    expect(await svc.sceneUrl('vn_scene_deleted')).toBeNull();
    expect(await svc.propUrl('vn_prop_deleted')).toBeNull();
  });

  it('fails soft to an empty manifest on a non-OK response and retries on the next call', async () => {
    let calls = 0;
    spyOn(globalThis, 'fetch').and.callFake((() => {
      calls += 1;
      return Promise.resolve(calls === 1 ? jsonResponse({}, false) : jsonResponse(MANIFEST));
    }) as typeof fetch);
    const svc = create();
    const first = await svc.manifest();
    expect(first.scenes).toEqual([]);
    expect(first.props).toEqual([]);
    // The failure was NOT cached — a transient outage never permanently blanks the picker.
    const second = await svc.manifest();
    expect(second.scenes.length).toBe(2);
    expect(calls).toBe(2);
  });

  it('fails soft to an empty manifest when fetch itself rejects, and retries later', async () => {
    let calls = 0;
    spyOn(globalThis, 'fetch').and.callFake((() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(jsonResponse(MANIFEST));
    }) as typeof fetch);
    const svc = create();
    expect((await svc.manifest()).scenes).toEqual([]);
    expect((await svc.manifest()).scenes.length).toBe(2);
  });

  it('tolerates a malformed manifest body (missing arrays become empty)', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse({ schemaVersion: 1, scenes: 'nope' }));
    const svc = create();
    const manifest = await svc.manifest();
    expect(manifest.scenes).toEqual([]);
    expect(manifest.props).toEqual([]);
  });

  it('caps a corrupt/oversized manifest at 64 entries per collection (parse boundary)', async () => {
    const flood = {
      schemaVersion: 1,
      scenes: Array.from({ length: 500 }, (_, i) => ({
        id: `s${i}`, displayName: `S${i}`, file: `s${i}.svg`, tags: [],
      })),
      props: Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, displayName: `P${i}`, file: `p${i}.svg` })),
    };
    spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse(flood));
    const svc = create();
    const manifest = await svc.manifest();
    expect(manifest.scenes.length).toBe(MAX_VN_MANIFEST_ENTRIES);
    expect(manifest.props.length).toBe(MAX_VN_MANIFEST_ENTRIES);
  });
});
