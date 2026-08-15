import { DestroyRef, inject, signal, Signal } from '@angular/core';

/**
 * The viewport width at which a companion column earns its place.
 *
 * 1200px ($bp-xl) is deliberately not the tablet breakpoint. A feed column is capped
 * around 40rem because long measure hurts readability, so a companion only fits once
 * there is ~40rem of genuinely SPARE width beside it — below that the two columns would
 * squeeze the timeline narrower than it is today, which is a downgrade dressed as a
 * feature. Landscape tablets and desktops clear it; portrait tablets and phones do not.
 */
export const WIDE_VIEWPORT_QUERY = '(min-width: 1200px)';

/**
 * True while the viewport is wide enough for a second column.
 *
 * WHY A SIGNAL RATHER THAN PURE CSS. Hiding a companion with `display: none` still
 * CONSTRUCTS the component, and these companions fetch: a phone would open a
 * notifications stream it never shows, on someone's data. Gating construction on the
 * signal means narrow viewports do no work at all. It also keeps the DOM honest for
 * assistive tech, which is not fooled by a hidden landmark it can still reach.
 *
 * Falls back to FALSE wherever `matchMedia` is unavailable (SSR, older test
 * environments). Single column is the safe default: it is what every viewport can
 * display, so a missing API degrades to the layout that always works.
 */
export function wideViewport(query: string = WIDE_VIEWPORT_QUERY): Signal<boolean> {
  const mm = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;

  const wide = signal(mm?.matches ?? false);
  if (!mm) {
    return wide.asReadonly();
  }

  const onChange = (e: MediaQueryListEvent) => wide.set(e.matches);
  // addEventListener is the modern API; addListener is kept for older WebKit, which some
  // of the fleet's kiosk/tablet targets still ship.
  if (typeof mm.addEventListener === 'function') {
    mm.addEventListener('change', onChange);
  } else if (typeof (mm as unknown as { addListener?: unknown }).addListener === 'function') {
    (mm as unknown as { addListener: (l: unknown) => void }).addListener(onChange);
  }

  inject(DestroyRef).onDestroy(() => {
    if (typeof mm.removeEventListener === 'function') {
      mm.removeEventListener('change', onChange);
    } else if (typeof (mm as unknown as { removeListener?: unknown }).removeListener === 'function') {
      (mm as unknown as { removeListener: (l: unknown) => void }).removeListener(onChange);
    }
  });

  return wide.asReadonly();
}
