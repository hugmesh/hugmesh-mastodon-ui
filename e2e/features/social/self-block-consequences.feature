# CROSS-USER coverage — the USER-tier SELF-BLOCK'S OBSERVABLE CONSEQUENCES in
# BOTH directions (audit gap: self-block.feature only clicks the 'internal'
# block and asserts the disclosure text; nothing proved the block DOES
# anything, and the 'mastodon'-platform external push was never exercised).
#
# What a Mastodon-platform self-block must really do:
#   FORWARD  — the blocked account's posts disappear from the BLOCKER'S
#              timelines (victim-creates-first: the post is SEEN before the
#              block — the positive control — and GONE after).
#   REVERSE  — the block force-severs the relationship in BOTH directions, so a
#              blocked account that previously followed the blocker loses
#              follower reach: the blocker's NEW followers-only posts never
#              arrive in the blocked account's home timeline, and the
#              relationship reads following:false from the blocked side.
#
# HONEST-FAILURE-NOTE (same stance as mod-consequences.feature): the
# 'mastodon'-platform self-block's external leg (user-bff BlockService →
# homeserver block) only lands when `block.mastodon.enabled=true` on the
# deployment. These scenarios assert the REAL consequences; on a stack where
# the external leg is disabled the disappearance never happens and the
# scenario FAILS — the honest outcome, never faked by trusting the click.
#
# PERSONA SAFETY: the blocked target is the DEDICATED "user-victim" persona
# (destructive-action target by charter). The blocker is "user-a": a USER-tier
# self-block affects only what user-a sees, and the one relationship this
# feature creates (user-victim → user-a) is severed by the block itself at the
# end — no other feature relies on user-victim following user-a.
#
# @cluster — ships dark; the default config filters `not @cluster`. bddgen
# still compiles + lists every scenario.
@cluster @mastodon-ui @cross-user @social
Feature: Self-block consequences — blocking really hides them, and really severs their reach back

  Scenario: blocking an account removes their posts from the blocker's timelines (victim-creates-first)
    Given "user-victim" has a seeded session in their own context
    And "user-a" has a seeded session in their own context
    When "user-victim" navigates to "/social/mastodon"
    And "user-victim" posts a "public" status tagged "sbc-src"
    Then the "sbc-src" status appears in the federated timeline of "user-a" within 90 seconds
    When "user-a" opens the actions menu on the "sbc-src" status
    And "user-a" clicks the "user-block-mastodon" control in the actions panel
    Then "user-a" sees the safety outcome disclosing the external push state
    And the "sbc-src" status disappears from the federated timeline of "user-a" within 120 seconds

  Scenario: blocking force-severs the mutual relationship — the blocked follower loses followers-only reach
    Given "user-victim" has a seeded session in their own context
    And "user-a" has a seeded session in their own context
    And "user-victim" follows "user-a" on mastodon
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "private" status tagged "sbc-priv-before"
    Then the "sbc-priv-before" status appears in the home timeline of "user-victim" within 90 seconds
    When "user-victim" navigates to "/social/mastodon"
    And "user-victim" posts a "public" status tagged "sbc-handle"
    Then the "sbc-handle" status appears in the federated timeline of "user-a" within 90 seconds
    When "user-a" opens the actions menu on the "sbc-handle" status
    And "user-a" clicks the "user-block-mastodon" control in the actions panel
    Then "user-a" sees the safety outcome disclosing the external push state
    And the relationship from "user-victim" to "user-a" reads not-following within 120 seconds
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "private" status tagged "sbc-priv-after"
    Then the "sbc-priv-after" status appears in the home timeline of "user-a" within 30 seconds
    And the "sbc-priv-after" status never appears in the home timeline of "user-victim"
