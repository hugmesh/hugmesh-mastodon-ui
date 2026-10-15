# OFFLINE / CLIENT-SIDE coverage — the server-wide block when mod-bff-api asks
# for an MFA step-up (403 + X-Step-Up-Required, hugmesh-mod-bff-api#16).
#
# Deterministic with page.route stubs of the one backend the action talks to
# (POST /bff/mod/block) and of the login remote's remoteEntry.json, driven
# against the dev shell with the same seeded client-side session the other
# offline role-menu features use. The dev shell serves no login remote, so the
# challenge itself cannot render here: what this proves is the honest
# fallback — the block is reported as NOT applied and the buttons come back —
# and that a plain role 403 is left alone. A rendered challenge and the retry
# are covered by the karma specs; a live proof stays with hugmesh-generator#506.
@mastodon-ui @offline @step-up
Feature: Server-wide block step-up — an unreachable challenge is reported honestly

  Scenario: a step-up refusal with no login remote says the block was not applied
    Given the home timeline API is stubbed with one post
    And the server-wide block is stubbed to demand a step-up
    And the login remote entry is stubbed as absent
    And "mod-a" has a seeded client-side session
    And a visitor opens the Home standalone page
    When "mod-a" opens the actions menu on the first post
    And "mod-a" requests a server-wide user block
    Then the block outcome reads "NOT applied" as an alert
    And the server-wide block was posted 1 time
    And the server-wide block buttons are enabled again

  Scenario: a plain 403 keeps the generic message and never asks for the login remote
    Given the home timeline API is stubbed with one post
    And the server-wide block is stubbed to refuse on role
    And the login remote entry is stubbed as absent
    And "mod-a" has a seeded client-side session
    And a visitor opens the Home standalone page
    When "mod-a" opens the actions menu on the first post
    And "mod-a" requests a server-wide user block
    Then the block outcome reads "Could not record the server-wide user block." as an alert
    And the login remote entry was requested 0 times
    And the server-wide block buttons are enabled again
