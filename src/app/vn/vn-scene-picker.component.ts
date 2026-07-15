import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PreferencesService } from '../preferences.service';
import { MAX_VN_PROPS, SceneService, VnPropEntry, VnSceneEntry } from './scene.service';

/**
 * Per-user scene + prop picker for the VN chat view: scene thumbnails (one
 * radio group) and a prop toggle list (checkboxes), both backed by the shipped
 * SceneService manifest.
 *
 * PERSISTENCE rides ENTIRELY on PreferencesService — the SAME chokepoint every
 * appearance choice uses: set('chatVnScene' / 'chatVnProps') applies locally
 * immediately, persists to the versioned localStorage blob and pushes the
 * durable mastodon.appearance.chat.vnScene / .vnProps keys to
 * GET/PUT /bff/user/preferences best-effort (a sync failure surfaces on the
 * service's syncError, never a silent no-op). This group is PERSONAL-ONLY:
 * setOrgDefault strips it, so a user's scene can never become the org default.
 *
 * chatVnProps is a comma-joined id list ('' = none), normalised here to the
 * manifest's order so the stored value is deterministic.
 */
@Component({
  selector: 'snap-mastodon-vn-scene-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './vn-scene-picker.component.html',
  styleUrl: './vn-scene-picker.component.scss',
})
export class VnScenePickerComponent implements OnInit {
  private readonly prefsSvc = inject(PreferencesService);
  private readonly scenesSvc = inject(SceneService);

  /** Live prefs signal the checked states derive from. */
  readonly prefs = this.prefsSvc.prefs;

  /** Per-instance uid so the radio-group name is unique with several pickers
   *  mounted at once (one per VN view). */
  private static seq = 0;
  private readonly uid = `vn-picker-${VnScenePickerComponent.seq++}`;
  readonly sceneGroupName = `${this.uid}-scene`;
  readonly ids = {
    sceneHelp: `${this.uid}-scene-help`,
    propsHelp: `${this.uid}-props-help`,
  };

  readonly sceneList = signal<VnSceneEntry[]>([]);
  readonly propList = signal<VnPropEntry[]>([]);
  /** Live-region text announcing the applied change (appearance-panel pattern). */
  readonly announcement = signal('');

  /** The enabled prop ids parsed from the stored comma-joined value.
   *  PARSE cap (MAX_VN_PROPS): a corrupt/hostile stored pref can list any
   *  number of ids — only the first 16 are ever considered. */
  readonly enabledProps = computed<ReadonlySet<string>>(
    () => new Set(this.prefs().chatVnProps.split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_VN_PROPS)),
  );

  async ngOnInit(): Promise<void> {
    // Fail-soft: an unreachable manifest renders an honest empty state, never
    // a broken picker (SceneService resolves to the empty manifest).
    const manifest = await this.scenesSvc.manifest();
    this.sceneList.set(manifest.scenes);
    this.propList.set(manifest.props);
  }

  isScene(id: string): boolean {
    return this.prefs().chatVnScene === id;
  }

  isProp(id: string): boolean {
    return this.enabledProps().has(id);
  }

  /** Thumbnail URL of a manifest entry (shipped asset). */
  thumbUrl(entry: VnSceneEntry | VnPropEntry): string {
    return this.scenesSvc.assetUrl(entry.file);
  }

  setScene(scene: VnSceneEntry): void {
    this.prefsSvc.set('chatVnScene', scene.id);
    this.announce(`Scene: ${scene.displayName}`);
  }

  toggleProp(prop: VnPropEntry): void {
    const next = new Set(this.enabledProps());
    const nowOn = !next.delete(prop.id);
    if (nowOn) {
      // WRITE cap (MAX_VN_PROPS, same limit as the parse/render sides): refuse
      // — and SAY so — rather than silently dropping a prop somewhere else.
      if (next.size >= MAX_VN_PROPS) {
        this.announce(`Prop limit reached — up to ${MAX_VN_PROPS} props can be on stage at once`, '');
        return;
      }
      next.add(prop.id);
    }
    // Normalise to manifest order so the stored comma-joined value is stable.
    const csv = this.propList()
      .filter((p) => next.has(p.id))
      .map((p) => p.id)
      .join(',');
    this.prefsSvc.set('chatVnProps', csv);
    this.announce(`Prop ${prop.displayName} ${nowOn ? 'on' : 'off'}`);
  }

  /** Announce in the live region (clear-then-set so repeats re-trigger).
   *  Default suffix "Applied." fits a successful change; pass '' for a
   *  refusal, which must never read as applied. */
  private announce(text: string, suffix = 'Applied.'): void {
    this.announcement.set('');
    setTimeout(() => this.announcement.set(suffix ? `${text}. ${suffix}` : text));
  }
}
