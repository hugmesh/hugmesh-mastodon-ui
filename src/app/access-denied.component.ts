import { Component } from '@angular/core';

/**
 * The "this account cannot use Mastodon" state.
 *
 * Shown IN PLACE of a Mastodon surface when the BFF refuses it with HTTP 403
 * (the user-bff-api hsproxy is role-gated on MASTODON — see
 * `MastodonAccessDeniedError` in mastodon.service.ts). Before this existed a persona without the
 * role saw the timeline's ordinary "Nothing here yet" and a completely blank
 * account page, both of which read as "the feed is empty" or "the page is
 * broken" rather than "you have not been given this".
 *
 * One component for the timeline, the notifications column and the account
 * page, so the wording cannot drift between them. It says what happened, what
 * it means for this page, and the one thing the reader can do about it.
 */
@Component({
  selector: 'hug-mastodon-access-denied',
  standalone: true,
  templateUrl: './access-denied.component.html',
  styleUrl: './access-denied.component.scss',
})
export class AccessDeniedComponent {}
