# CROSS-USER coverage — FOLLOW REQUESTS on a LOCKED account (audit gap: the
# profile button renders 'Requested' (Relationship.requested) and the
# notifications column renders follow_request rows, but no scenario ever
# exercised a locked target: follow → Requested → approval → private reach.
# post-visibility only ever uses API-seeded ACCEPTED follows).
#
# UI vs API split (honest tooling): the FOLLOW is a real UI click and the
# 'Requested' label is the real rendered Relationship; the LOCK and the
# APPROVAL are API-seeded from the TARGET'S own cookie-authed session because
# the remote ships no profile-editing or follow-request-approval UI (both
# documented UI-absent in the audit's preferences inventory) — the observed
# surfaces are the requester's button state, the target's follow_request
# notification, and the post-approval private reach.
#
# PERSONA SAFETY: the locked target is "user-victim" (the destructive-action
# persona); the requester is "user-c". user-c's only reserved relationship
# meaning elsewhere is NON-follower OF USER-A (post-visibility) — a follow of
# user-victim carries no reservation. The scenario RE-UNLOCKS user-victim at
# the end so later runs of other features meet an unlocked account; a
# mid-scenario abort can leave the lock in place (re-running this scenario
# re-seeds it deterministically either way).
#
# @cluster — ships dark; the default config filters `not @cluster`.
@cluster @mastodon-ui @cross-user @social
Feature: Follow requests — a locked account gates followers behind approval

  Scenario: following a locked account reads Requested until approved, then private reach opens
    Given "user-victim" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    And "user-victim" sets their account locked "true" via the API
    When "user-c" navigates to the profile of "user-victim"
    And "user-c" clicks the follow button expecting a pending request
    Then "user-c" sees the follow button labelled "Requested" for "user-victim"
    And "user-victim" sees a follow request notification from "user-c" within 90 seconds
    When "user-victim" approves the follow request from "user-c" via the API
    Then the relationship from "user-c" to "user-victim" reads following within 90 seconds
    When "user-victim" navigates to "/social/mastodon"
    And "user-victim" posts a "private" status tagged "fr-private"
    Then the "fr-private" status appears in the home timeline of "user-c" within 90 seconds
    And "user-victim" sets their account locked "false" via the API
