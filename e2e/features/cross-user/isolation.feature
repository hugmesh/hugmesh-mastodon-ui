# CROSS-USER ISOLATION coverage — the role-tier invariant AND cross-tenant
# isolation, asserted with both identities live in one scenario (each in its own
# context via "seeded session in their own context") so isolation is proven, not
# faked by swapping a single session.
#
# Two threat surfaces:
#   1. ROLE-TIER LEAK — a plain user must NOT see the MOD tier, and a mod must
#      NOT see the ADMIN tier, even when a more-privileged user is live in the
#      same scenario. The display-layer tier is backed by the bff-api role gate.
#   2. CROSS-TENANT — a domain-B user's bff_ session must not read domain-A
#      data; the user-/mod-bff-api re-enforces role + scope, so the call
#      fails-closed (401 unauth / 403 forbidden) even if the UI were bypassed.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @mastodon-ui @cross-user
Feature: Cross-user isolation — role-tier leaks and cross-tenant reads are denied
  As the federated social platform
  I must keep each role tier and each tenant isolated from the others
  So an under-privileged or cross-tenant token can neither see nor mutate beyond its grant

  Scenario: a plain user never sees the MOD tier even alongside a live mod
    Given "user-a" has a seeded session in their own context
    And "mod-a" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "mod-a" navigates to "/social/mastodon"
    And "user-a" opens the actions menu on the first post
    And "mod-a" opens the actions menu on the first post
    Then "user-a" does not see the "tier-mod" tier
    And "mod-a" sees the "tier-mod" tier

  Scenario: a mod never sees the ADMIN tier even alongside a live admin
    Given "mod-a" has a seeded session in their own context
    And "admin-a" has a seeded session in their own context
    When "mod-a" navigates to "/social/mastodon"
    And "admin-a" navigates to "/social/mastodon"
    And "mod-a" opens the actions menu on the first post
    And "admin-a" opens the actions menu on the first post
    Then "mod-a" does not see the "tier-admin" tier
    And "admin-a" sees the "tier-admin" tier

  Scenario: a plain user is denied the mod-bff moderation queue (403)
    Given "user-a" has a seeded session in their own context
    And "mod-a" has a seeded session in their own context
    When "user-a" GETs "/bff/mod/moderation"
    Then the response status is 403

  Scenario: a domain-B user cannot server-wide block via the mod-bff (403)
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    When "user-b" POSTs "/bff/mod/block"
    Then the response status is 403

  Scenario: an unauthenticated client is rejected by the mod-bff (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/mod/moderation"
    Then the response status is 401
