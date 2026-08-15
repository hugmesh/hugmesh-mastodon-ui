import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { wideViewport, WIDE_VIEWPORT_QUERY } from './wide-viewport';

/**
 * The viewport gate behind the companion column.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A MEDIA QUERY. Hiding a companion with `display: none`
 * still CONSTRUCTS the component, and these companions fetch — a phone would open a
 * notifications stream it never displays, on someone's mobile data. Gating construction
 * means narrow viewports do no work at all, so these tests pin that the signal actually
 * tracks the media query rather than being decorative.
 */
describe('wideViewport', () => {
  let listeners: Array<(e: MediaQueryListEvent) => void>;
  let removed: number;

  function fakeMatchMedia(matches: boolean, opts: { legacy?: boolean } = {}) {
    listeners = [];
    removed = 0;
    const mql: Record<string, unknown> = { matches, media: WIDE_VIEWPORT_QUERY };
    if (opts.legacy) {
      // Older WebKit, which some kiosk/tablet targets in this fleet still ship.
      mql['addListener'] = (l: (e: MediaQueryListEvent) => void) => listeners.push(l);
      mql['removeListener'] = () => { removed += 1; };
    } else {
      mql['addEventListener'] = (_: string, l: (e: MediaQueryListEvent) => void) => listeners.push(l);
      mql['removeEventListener'] = () => { removed += 1; };
    }
    (window as unknown as { matchMedia: unknown }).matchMedia = () => mql;
  }

  @Component({ standalone: true, template: '' })
  class Host {
    readonly wide = wideViewport();
  }

  let original: typeof window.matchMedia;
  beforeEach(() => { original = window.matchMedia; });
  afterEach(() => { (window as unknown as { matchMedia: unknown }).matchMedia = original; });

  function mount() {
    TestBed.configureTestingModule({ imports: [Host] });
    return TestBed.createComponent(Host);
  }

  it('starts from the query’s current state', () => {
    fakeMatchMedia(true);
    expect(mount().componentInstance.wide()).toBeTrue();
  });

  it('reacts when the viewport crosses the breakpoint', () => {
    fakeMatchMedia(false);
    const f = mount();
    expect(f.componentInstance.wide()).toBeFalse();

    listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
    expect(f.componentInstance.wide()).toBeTrue();

    listeners.forEach((l) => l({ matches: false } as MediaQueryListEvent));
    expect(f.componentInstance.wide()).toBeFalse();
  });

  it('unsubscribes when the component is destroyed', () => {
    // A leaked media listener on a long-lived SPA accumulates one per navigation.
    fakeMatchMedia(true);
    const f = mount();
    f.destroy();
    expect(removed).toBe(1);
  });

  it('supports the legacy addListener API', () => {
    fakeMatchMedia(false, { legacy: true });
    const f = mount();
    listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
    expect(f.componentInstance.wide()).toBeTrue();
    f.destroy();
    expect(removed).toBe(1);
  });

  it('falls back to the SINGLE-COLUMN layout when matchMedia is unavailable', () => {
    // Single column is what every viewport can display, so a missing API must degrade to
    // the layout that always works rather than to the one that needs 1200px.
    (window as unknown as { matchMedia: unknown }).matchMedia = undefined;
    expect(mount().componentInstance.wide()).toBeFalse();
  });

  it('asks for a breakpoint that leaves the feed its full measure', () => {
    // 1200px is not the tablet breakpoint on purpose: below it, a second column would
    // squeeze the timeline narrower than it is today.
    expect(WIDE_VIEWPORT_QUERY).toBe('(min-width: 1200px)');
  });
});
