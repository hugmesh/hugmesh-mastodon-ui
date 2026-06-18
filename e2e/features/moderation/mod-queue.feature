# MULTIUSER-SITUATIONAL coverage — moderation acting over a shared,
# server-wide resource. The MOD tier's server-wide block + moderation queue
# affect EVERYONE on the server, not just the actor; the refer-to-admin path is
# the ONLY mod escalation (a mod never decides directly). These exercise the
# (pleroma/admin-equivalent) moderation surface that requires mod or admin.
#
# The display-layer tier is backed by the mod-bff-api hasAnyRole('MOD','ADMIN')
# gate, re-asserted in the cross-user feature at the API layer.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @mastodon-ui @multiuser
Feature: Moderation queue & server-wide block — the MOD/ADMIN shared surface
  As a moderator
  I must triage the server-wide moderation queue and block across the whole server
  So abuse is handled for every user, with escalation to an admin for final calls

  Scenario: a mod can open the server-wide moderation queue
    Given "mod-a" has a seeded session
    When "mod-a" navigates to "/social/mastodon"
    And "mod-a" opens the actions menu on the first post
    Then "mod-a" sees the "tier-mod" tier
    And "mod-a" can use the "mod-load-queue" control

  Scenario: a mod can issue a server-wide block (affects everyone)
    Given "mod-a" has a seeded session
    When "mod-a" navigates to "/social/mastodon"
    And "mod-a" opens the actions menu on the first post
    Then "mod-a" can use the "mod-block-user" control

  Scenario: an admin also reaches the MOD tier (admin folds into mod)
    Given "admin-a" has a seeded session
    When "admin-a" navigates to "/social/mastodon"
    And "admin-a" opens the actions menu on the first post
    Then "admin-a" sees the "tier-mod" tier
    And "admin-a" can use the "mod-load-queue" control

  Scenario: the mod-bff moderation queue requires a mod/admin role (API ALLOW)
    Given "mod-a" has a seeded session
    When "mod-a" GETs "/bff/mod/moderation"
    Then the response status is 200
