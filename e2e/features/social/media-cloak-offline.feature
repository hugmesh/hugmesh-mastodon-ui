# OFFLINE / CLIENT-SIDE coverage — the composer's IMAGE file-picker path and
# the AI-CLOAK badge lifecycle (audit gap: the cloak capability probe, badge
# states, escape hatch, "posted without protection" notice and the poison
# on/off routing decision had no e2e at all; only the voice/video recorder
# path was covered). Also closes the flagged "AI-cloak default on/off"
# preference gap: the compose-poison-toggle is exercised for real, including
# its per-browser persistence.
#
# Everything is deterministic with page.route stubs of the two backends the
# composer talks to:
#   /bff/user/media/capability | upload | status/{ref}   (the cloak BFF)
#   /bff/user/mastodon/api/v2/media                      (the direct hsproxy)
# The assertions are the composer's REAL badge/notice markup and — for the
# routing scenarios — WHICH endpoint the upload actually hit (captured off the
# stub), the exact contract the cloak exists for (poison-before-ingest).
@mastodon-ui @offline @media-cloak
Feature: AI-cloak media offline — badge lifecycle, escape hatch, unavailability and the opt-out route

  Background:
    Given the preferences API is stubbed

  Scenario: an attached image rides the BFF poison route and the badge flips pending to protected
    Given the cloak capability is stubbed as available with backend "cuda"
    And the cloak upload is stubbed to answer pending then report "protected"
    And a visitor opens the Home standalone page
    When the visitor attaches a generated image to the composer
    Then the image upload went to the BFF poison route, not the homeserver
    And the attachment badge reads "Applying AI-cloak (Glaze)…"
    Then the attachment badge becomes "AI-cloak applied (Glaze)" within 15 seconds
    And no escape hatch is offered once protection resolved

  Scenario: the escape hatch flips a pending badge to Posted without AI-cloak and stops the polling
    Given the cloak capability is stubbed as available with backend "cuda"
    And the cloak upload is stubbed to stay pending forever
    And a visitor opens the Home standalone page
    When the visitor attaches a generated image to the composer
    Then the attachment badge reads "Applying AI-cloak (Glaze)…"
    When the visitor clicks the cloak escape hatch
    Then the attachment badge reads "Posted without AI-cloak"
    And the cloak status endpoint is no longer polled

  Scenario: a degraded round-trip is reported as weakened, never upgraded to protected
    Given the cloak capability is stubbed as available with backend "cpu"
    And the cloak upload is stubbed to answer pending then report "degraded"
    And a visitor opens the Home standalone page
    When the visitor attaches a generated image to the composer
    Then the attachment badge becomes "AI-cloak weakened — washed out by re-encode" within 15 seconds

  Scenario: an absent heavy tier posts unprotected with an honest notice, through the homeserver route
    Given the cloak capability is stubbed as unavailable
    And the homeserver media upload is stubbed
    And a visitor opens the Home standalone page
    When the visitor attaches a generated image to the composer
    Then the image upload went to the homeserver route, not the BFF
    And the attachment badge reads "AI-cloak unavailable on this server"
    And the posted-without-protection notice is announced

  Scenario: toggling AI-cloak off routes the upload straight to the homeserver and persists per browser
    Given the cloak capability is stubbed as available with backend "cuda"
    And the homeserver media upload is stubbed
    And a visitor opens the Home standalone page
    When the visitor toggles AI-cloak off
    And the visitor attaches a generated image to the composer
    Then the image upload went to the homeserver route, not the BFF
    And the attachment badge reads "No AI-cloak"
    When the visitor reloads the page
    Then the AI-cloak toggle still reads off
