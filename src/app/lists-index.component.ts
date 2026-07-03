import { Component, OnInit, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MastodonService, MastodonList } from './mastodon.service';

/** Mastodon Lists feature: renders all user-defined lists, each linking to its
 *  list timeline (lists/:id), showing the replies_policy — and lets the user
 *  CREATE a new list inline (titled input + button → POST /api/v1/lists), the
 *  in-app control the native client has and this remote previously lacked. */
@Component({
  selector: 'snap-mastodon-lists-index',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './lists-index.component.html',
  styleUrl: './lists-index.component.scss',
})
export class ListsIndexComponent implements OnInit {
  private readonly mastodon = inject(MastodonService);

  readonly lists = signal<MastodonList[]>([]);
  readonly loading = signal(false);

  /** Signal backing the create-list title. `newTitle` is exposed as a plain
   *  accessor so `[(ngModel)]` two-way binds it and tests set it directly, but
   *  the value lives in a signal so `canCreate` — and thus the submit button's
   *  disabled state — reacts the instant the title changes. A plain field does
   *  NOT drive this app's change detection for the `[disabled]` binding (the
   *  composer solves the same problem with its `draftSig` mirror). */
  private readonly titleSig = signal('');
  get newTitle(): string {
    return this.titleSig();
  }
  set newTitle(value: string) {
    this.titleSig.set(value);
  }

  /** In-flight guard for the create POST — disables the submit + input so a
   *  double-click can't fire two creates, mirroring the composer's `posting`. */
  readonly creating = signal(false);

  /** Set when the server REJECTED a create (4xx/5xx or a network failure). Shown
   *  as an assertive alert so the failure is ANNOUNCED, never a silent no-op; the
   *  typed title is kept so the user loses nothing and the index is unchanged.
   *  Cleared on the next submit attempt. */
  readonly createError = signal<string | null>(null);

  trackId = (_: number, l: MastodonList): string => l.id;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      this.lists.set(await this.mastodon.lists());
    } finally {
      this.loading.set(false);
    }
  }

  /** A create is allowed only with a non-blank title — the empty-title guard the
   *  submit button binds to (disabled) AND `create()` re-checks, so no whitespace
   *  title can ever reach the wire. A reactive computed (reads the title signal)
   *  so the button enables/disables the moment the field changes. */
  readonly canCreate = computed(() => this.titleSig().trim().length > 0);

  async create(): Promise<void> {
    // Belt-and-suspenders with the disabled button: bail on a blank title or an
    // in-flight create so a programmatic/Enter-key path can't POST an empty title
    // nor fire a duplicate request.
    if (!this.canCreate() || this.creating()) return;
    const title = this.newTitle.trim();
    this.creating.set(true);
    this.createError.set(null);
    try {
      const created = await this.mastodon.createList(title);
      // Add the server-confirmed list (its REAL id/replies_policy came back on
      // the POST) to the top of the index — no optimistic row that could outlive
      // a rejected request. Then clear the input for the next one.
      this.lists.set([created, ...this.lists()]);
      this.newTitle = '';
    } catch {
      // The homeserver rejected the create (or the network failed). Announce it
      // honestly and leave the index + typed title untouched.
      this.createError.set('Could not create the list. Please try again.');
    } finally {
      this.creating.set(false);
    }
  }
}
