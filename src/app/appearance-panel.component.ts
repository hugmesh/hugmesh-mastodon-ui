import { Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
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
  ChatBubbleShape,
  ChatFont,
  ChatDensity,
  ChatBackground,
  VnDialogSkin,
} from './preferences.service';

/** A selectable option rendered as a real radio/segmented control. */
interface Option<T> {
  value: T;
  label: string;
}

/**
 * STYLE + VIEW PREFERENCES (Appearance) panel for the hugmesh-mastodon-ui
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
  selector: 'hug-mastodon-appearance-panel',
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

  constructor() {
    // Honest disclosure: a failed durable/cross-device or platform-wide save is
    // NEVER a silently-accepted no-op — announce it in the SAME accessible live
    // region as every other applied change, so a sync failure is never invisible.
    effect(() => {
      const err = this.prefsSvc.syncError();
      if (err) this.announce(err, '');
    });
  }

  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('panel') panel?: ElementRef<HTMLElement>;
  @ViewChild('firstControl') firstControl?: ElementRef<HTMLElement>;

  // ── Option catalogues (the TangerineUI-equivalent set) ──────────────────
  readonly themes: Option<ColorTheme>[] = [
    { value: 'hug-neon', label: 'Hug Neon' },
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

  // ── CHAT theme option catalogues (personal-only — no admin-default control
  //    for this group by design; see PreferencesService.setOrgDefault). ─────
  readonly chatShapes: Option<ChatBubbleShape>[] = [
    { value: 'rounded', label: 'Rounded' },
    { value: 'square', label: 'Square' },
    { value: 'sharp', label: 'Sharp' },
  ];
  readonly chatFonts: Option<ChatFont>[] = [
    { value: 'system', label: 'System' },
    { value: 'serif', label: 'Serif' },
    { value: 'rounded', label: 'Rounded' },
    { value: 'mono', label: 'Monospace' },
  ];
  readonly chatDensities: Option<ChatDensity>[] = [
    { value: 'cozy', label: 'Cozy' },
    { value: 'compact', label: 'Compact' },
  ];
  readonly chatBackgrounds: Option<ChatBackground>[] = [
    { value: 'none', label: 'None' },
    { value: 'dots', label: 'Dots' },
    { value: 'lined', label: 'Lined' },
    { value: 'stars', label: 'Stars' },
  ];
  readonly vnSkins: Option<VnDialogSkin>[] = [
    { value: 'classic', label: 'Classic' },
    { value: 'glass', label: 'Glass' },
    { value: 'retro', label: 'Retro' },
  ];

  /** What the colour pickers DISPLAY while the accent is unset (''): the same
   *  tokens the SCSS fallbacks resolve to (--hug-accent / --hug-border defaults),
   *  so the swatch honestly previews the effective colour. Picking any colour —
   *  including these — saves an explicit choice. */
  readonly chatAccentMineDisplay = computed(() => this.prefs().chatAccentMine || '#7c4dff');
  readonly chatAccentTheirsDisplay = computed(() => this.prefs().chatAccentTheirs || '#1e1e32');

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

  // ── CHAT theme setters (mirror the pattern above) ────────────────────────
  setChatShape(v: ChatBubbleShape): void {
    this.prefsSvc.set('chatBubbleShape', v);
    this.announce(this.labelFor('Chat bubble shape', v));
  }
  /** The colour inputs only ever emit #rrggbb; the service re-validates before
   *  anything is applied, persisted or synced (defence-in-depth). */
  setChatAccentMine(v: string): void {
    this.prefsSvc.set('chatAccentMine', v);
    this.announce(this.labelFor('Your bubble colour', v));
  }
  setChatAccentTheirs(v: string): void {
    this.prefsSvc.set('chatAccentTheirs', v);
    this.announce(this.labelFor('Their bubble colour', v));
  }
  setChatFont(v: ChatFont): void {
    this.prefsSvc.set('chatFont', v);
    this.announce(this.labelFor('Chat font', v));
  }
  setChatDensity(v: ChatDensity): void {
    this.prefsSvc.set('chatDensity', v);
    this.announce(this.labelFor('Chat density', v));
  }
  setChatBackground(v: ChatBackground): void {
    this.prefsSvc.set('chatBackground', v);
    this.announce(this.labelFor('Chat background', v));
  }
  setVnSkin(v: VnDialogSkin): void {
    this.prefsSvc.set('vnDialogSkin', v);
    this.announce(this.labelFor('Dialogue box style', v));
  }

  /** Reset ONLY the chat group; the rest of the appearance stays as chosen. */
  resetChatToDefault(): void {
    this.prefsSvc.resetChatToDefault();
    this.announce('Chat style reset to the default');
  }

  // ── ADMIN: set the current selection as the org default ─────────────────
  /** Defence-in-depth: the template only renders this for admins, and we re-check
   *  here so a stale DOM can't trigger it for a non-admin. Applies + saves
   *  immediately; {@link PreferencesService.syncError} (announced via the
   *  effect in the constructor) is the honest signal if the durable,
   *  platform-wide write did not actually reach admin-bff. */
  setAsDefaultForEveryone(): void {
    if (!this.session.isAdmin()) return;
    this.prefsSvc.setOrgDefault(this.prefsSvc.snapshot());
    this.announce('Saved the current appearance as the default for everyone');
  }

  /** Announce {@code text} in the live region, followed by {@code suffix}
   *  (default {@code 'Applied.'} for a successful change; pass {@code ''} for
   *  a sync-failure message, which reads awkwardly with that suffix). */
  private announce(text: string, suffix = 'Applied.'): void {
    // Clear then set so a repeated value still re-triggers the live region.
    this.announcement.set('');
    setTimeout(() => this.announcement.set(suffix ? `${text}. ${suffix}` : text));
  }
}
