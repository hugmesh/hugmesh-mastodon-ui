# MULTIUSER-SITUATIONAL coverage — moderation actions ACTUALLY FIRED and their
# consequences OBSERVED, across per-persona contexts. Where the earlier
# mod-queue feature proved the controls render enabled for the right roles,
# these scenarios CLICK them and assert two things the platform standard
# demands:
#
#   1. THE HONEST ENVELOPE — mod-bff never fakes success:
#      · POST /bff/mod/block answers 200 + {external:'ok'} ONLY when the
#        homeserver-admin call really landed; a stubbed/degraded leg is 202 +
#        {external: stubbed|degraded:...}. The UI live region relays whichever
#        it was VERBATIM, so the outcome step accepts ANY truthful disclosure
#        ("External: ok|stubbed|degraded…") and the consequence steps that
#        follow prove whether the leg actually landed — a shown "ok" must be
#        backed by the observed effect, a shown "degraded" honestly fails the
#        effect steps. The MATRIX leg is STUBBED BY DESIGN (tuwunel has no
#        REST admin API) and must NEVER show success — that invariant is
#        pinned by the dedicated Matrix scenario below.
#      · POST /bff/mod/ban is desired-state → ALWAYS 202 pending-reconcile.
#   2. THE REAL CONSEQUENCE — observed behaviourally with positive controls
#      first: the victim's post is seen BEFORE the block, gone AFTER; the ban is
#      polled at the hsproxy until it actually rejects, THEN the composer's
#      announced error is asserted.
#
# The block/ban target is the DEDICATED "user-victim" persona so these
# destructive, server-wide actions never poison user-a/user-b for the rest of
# the run. CAVEAT for live runs: server-wide user/instance blocks have no
# unblock endpoint on the mod-bff, so this feature needs a reseedable stack
# (run it in isolation or reseed after).
#
# HONEST-FAILURE NOTE: the block-consequence scenarios TARGET A WIRED AKKOMA
# STACK. Their disappearance/denial steps are polled from the REAL
# timelines/proxy, so BOTH forks stay honest: on a stack where the enforcement
# leg cannot land (the degraded dev substitute — pleroma-admin verbs 404) the
# operator sees "External: degraded…" and the effect steps FAIL — correctly;
# on a healthy Akkoma stack the leg lands, the operator sees the truthful
# "External: ok." and the effects are observed. Neither fork may be weakened
# to pass with a disclosure that contradicts the observed reality.
#
# @cluster — ships dark; config filters `not @cluster`, bddgen still compiles.
@cluster @mastodon-ui @multiuser
Feature: Moderation consequences — honest envelopes and observable server-wide effects
  As a moderator acting server-wide
  I must see exactly what my action did (stubbed/degraded/pending, never a fake OK)
  And the platform must actually enforce it against the target and every observer

  Scenario: a server-wide user block is honest to the mod and silences the author for observers
    Given "mod-a" has a seeded session in their own context
    And "user-victim" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-victim" navigates to "/social/mastodon"
    And "user-victim" posts a "public" status tagged "blk"
    Then the "blk" status appears in the federated timeline of "user-c" within 30 seconds
    When "mod-a" navigates to "/social/mastodon/public"
    And "mod-a" opens the actions menu on the "blk" status
    And "mod-a" clicks the "mod-block-user" control in the actions panel
    Then "mod-a" sees the moderation outcome disclosed truthfully
    And the "blk" status disappears from the federated timeline of "user-c" within 120 seconds
    And the mastodon proxy rejects posts from "user-victim" within 120 seconds
    When "user-victim" navigates to "/social/mastodon"
    And "user-victim" attempts to post a status tagged "blk-after"
    Then "user-victim" sees the compose submit rejected with an announced error

  Scenario: a server-wide instance block removes that host's posts from timelines
    Given "mod-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-b" navigates to "/social/mastodon"
    And "user-b" posts a "public" status tagged "inst-blk"
    Then the "inst-blk" status appears in the federated timeline of "mod-a" within 90 seconds
    When "mod-a" opens the actions menu on the "inst-blk" status
    And "mod-a" clicks the "mod-block-instance" control in the actions panel
    Then "mod-a" sees the moderation outcome disclosed truthfully
    And the "inst-blk" status disappears from the federated timeline of "user-c" within 120 seconds

  Scenario: the Matrix leg surfaces STUBBED honestly — never a fake success
    Given "mod-a" has a seeded session in their own context
    When "mod-a" requests a "matrix"-platform server block of "user-victim"
    Then the block response is the honest stubbed envelope

  Scenario: a banned user cannot post — pending-reconcile envelope, then a real announced denial
    Given "mod-a" has a seeded session in their own context
    And "user-victim" has a seeded session in their own context
    When "mod-a" bans "user-victim" from the mastodon platform
    Then the moderation response is the honest pending-reconcile envelope
    And the mastodon proxy rejects posts from "user-victim" within 120 seconds
    When "user-victim" navigates to "/social/mastodon"
    And "user-victim" attempts to post a status tagged "ban-after"
    Then "user-victim" sees the compose submit rejected with an announced error
