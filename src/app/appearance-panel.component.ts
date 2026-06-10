import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SessionService } from './session.service';
import {
  PreferencesService,
  AppearancePreferences,
  ColorTheme,
  Accent,
  Appearance,
  Layout,
  Density,
  MediaCorners,
  FontFamily,
  TextSize,
} from './preferences.service';

/** A selectable option rendered as a real radio/segmented control. */
interface Option<T> {
  value: T;
  label: string;
}

/**
 * STYLE + VIEW PREFERENCES (Appearance) panel for the snapdragon-mastodon-ui
 * remote — modelled on the spirit of nileane/TangerineUI-for-Mastodon. Reachable
 * from the timeline header gear; available to EVERY signed-in user (user / mod /
 * admin) to customise their OWN look.
 *
 * Each choice is pushed to {@link PreferencesService}, which sets a `data-*`
 * attribute / CSS custom property on this remote's root(s) so the timeline /
 * toots / profile restyle live, and persists it to a versioned localStorage key.
 *
 * ADMIN-ONLY: an extra "set as the default for everyone" control writes the org
 * default that non-customised users inherit (honestly local/asset-backed for
 * this PR — see PreferencesService.setOrgDefault). Gated on
 * SessionService.isAdmin() so user/mod never see it (defence-in-depth; the
 * admin-bff would enforce server-side).
 */
@Component({
  selector: 'snap-mastodon-appearance-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './appearance-panel.component.html',
  styleUrl: './appearance-panel.component.scss',
})
export class AppearancePanelComponent {
  readonly session = inject(SessionService);
  private readonly prefsSvc = inject(PreferencesService);

  /** Live snapshot the template binds to (kept in sync on every change). */
  readonly prefs = this.prefsSvc.prefs;

  readonly open = signal(false);
  /** Live-region text announcing the most-recently applied change. */
  readonly announcement = signal('');
  /** True once the user has saved at least one explicit choice. */
  readonly customised = computed(() => this.prefsSvc.isCustomised() || this.prefs() !== null);

  /** ADMIN tier only: the default-setter control. */
  readonly isAdmin = this.session.isAdmin;

  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('panel') panel?: ElementRef<HTMLElement>;
  @ViewChild('firstControl') firstControl?: ElementRef<HTMLElement>;

  // ── Option catalogues (the TangerineUI-equivalent set) ──────────────────
  readonly themes: Option<ColorTheme>[] = [
    { value: 'snap-neon', label: 'Snap Neon' },
    { value: 'pastel-rose', label: 'Pastel Rose' },
    { value: 'pastel-sky', label: 'Pastel Sky' },
    { value: 'pastel-mint', label: 'Pastel Mint' },
    { value: 'mono', label: 'Monochrome' },
  ];
  readonly accents: Option<Accent>[] = [
    { value: 'neon', label: 'Neon' },
    { value: 'rose', label: 'Rose' },
    { value: 'lavender', label: 'Lavender' },
    { value: 'sky', label: 'Sky' },
    { value: 'mint', label: 'Mint' },
    { value: 'peach', label: 'Peach' },
  ];
  readonly appearances: Option<Appearance>[] = [
    { value: 'auto', label: 'Auto (system)' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  readonly layouts: Option<Layout>[] = [
    { value: 'single', label: 'Single column' },
    { value: 'multi', label: 'Multi column' },
  ];
  readonly densities: Option<Density>[] = [
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' },
  ];
  readonly corners: Option<MediaCorners>[] = [
    { value: 'rounded', label: 'Rounded' },
    { value: 'square', label: 'Square' },
  ];
  readonly fonts: Option<FontFamily>[] = [
    { value: 'system', label: 'System' },
    { value: 'serif', label: 'Serif' },
    { value: 'mono', label: 'Monospace' },
    { value: 'dyslexic', label: 'Dyslexia-friendly' },
  ];
  readonly textSizes: Option<TextSize>[] = [
    { value: 'sm', label: 'Small' },
    { value: 'md', label: 'Medium' },
    { value: 'lg', label: 'Large' },
    { value: 'xl', label: 'Extra large' },
  ];

  toggle(): void {
    this.open.set(!this.open());
    if (this.open()) {
      // Focus the first control once the panel renders.
      setTimeout(() => this.firstControl?.nativeElement.focus());
    }
  }

  close(returnFocus = true): void {
    this.open.set(false);
    if (returnFocus) this.trigger?.nativeElement.focus();
  }

  onPanelKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.close();
    }
  }

  // ── apply a single preference + announce it ─────────────────────────────
  private labelFor<K extends keyof AppearancePreferences>(group: string, value: AppearancePreferences[K]): string {
    return `${group}: ${String(value)}`;
  }

  setTheme(v: ColorTheme): void {
    this.prefsSvc.set('theme', v);
    this.announce(this.labelFor('Theme', v));
  }
  setAccent(v: Accent): void {
    this.prefsSvc.set('accent', v);
    this.announce(this.labelFor('Accent', v));
  }
  setAppearance(v: Appearance): void {
    this.prefsSvc.set('appearance', v);
    this.announce(this.labelFor('Appearance', v));
  }
  setLayout(v: Layout): void {
    this.prefsSvc.set('layout', v);
    this.announce(this.labelFor('Layout', v));
  }
  setDensity(v: Density): void {
    this.prefsSvc.set('density', v);
    this.announce(this.labelFor('Density', v));
  }
  setCorners(v: MediaCorners): void {
    this.prefsSvc.set('mediaCorners', v);
    this.announce(this.labelFor('Media corners', v));
  }
  setFont(v: FontFamily): void {
    this.prefsSvc.set('font', v);
    this.announce(this.labelFor('Font', v));
  }
  setTextSize(v: TextSize): void {
    this.prefsSvc.set('textSize', v);
    this.announce(this.labelFor('Text size', v));
  }
  setHighContrast(on: boolean): void {
    this.prefsSvc.set('highContrast', on);
    this.announce(`High contrast ${on ? 'on' : 'off'}`);
  }
  setReducedMotion(on: boolean): void {
    this.prefsSvc.set('reducedMotion', on);
    this.announce(`Reduced motion ${on ? 'on' : 'off'}`);
  }

  resetToDefault(): void {
    this.prefsSvc.resetToDefault();
    this.announce('Appearance reset to the default');
  }

  // ── ADMIN: set the current selection as the org default ─────────────────
  /** Defence-in-depth: the template only renders this for admins, and we re-check
   *  here so a stale DOM can't trigger it for a non-admin. */
  setAsDefaultForEveryone(): void {
    if (!this.session.isAdmin()) return;
    this.prefsSvc.setOrgDefault(this.prefsSvc.snapshot());
    this.announce('Saved the current appearance as the default for everyone (local to this browser for now)');
  }

  private announce(text: string): void {
    // Clear then set so a repeated value still re-triggers the live region.
    this.announcement.set('');
    setTimeout(() => this.announcement.set(`${text}. Applied.`));
  }
}
