# USER-SITUATIONAL coverage — the social DOMAIN-LOCK composer gate: the
# disabled+helptext surface the wave demands.
#
# A domain-locked user (session carries `mastodon_domainlocked`, lowercased from
# ROLE_MASTODON_DOMAINLOCKED by the BFF) has their posts forced LOCAL-ONLY by the
# homeserver's force-local MRF. The composer signals this HONESTLY:
#   · the local-only toggle is aria-disabled + aria-pressed=true (ENFORCED ON) —
#     NOT native-disabled, so a screen reader still lands on it and reads WHY.
#   · the public + unlisted visibility options are disabled (their reach never
#     federates), while Followers/Direct stay selectable.
#   · a why-helptext explains the lock, wired via aria-describedby.
# An UNLOCKED user sees the toggle aria-disabled + aria-pressed=false (the
# per-post local-only flag is simply unwired) and all visibility options enabled.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @mastodon-ui @user-situational
Feature: Domain-lock composer gate — disabled controls with honest helptext
  As a domain-locked Mastodon user
  I must see federated-reach controls disabled with an explanation
  So I am never invited to believe a post will federate when it provably cannot

  Scenario: a domain-locked user sees local-only enforced with helptext
    Given "locked-user" has a seeded session
    When "locked-user" navigates to "/social/mastodon"
    Then "locked-user" sees the local-only toggle enforced
    And "locked-user" sees the local-only help text

  Scenario: a domain-locked user cannot pick a federated visibility (disabled + helptext)
    Given "locked-user" has a seeded session
    When "locked-user" navigates to "/social/mastodon"
    Then "locked-user" sees the federated visibility options disabled

  Scenario: an unlocked user sees the local-only toggle unavailable (unwired, not enforced)
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    Then "user-a" sees the local-only toggle unavailable
    And "user-a" sees the local-only help text

  Scenario: an unlocked user can choose any post visibility (ALLOW)
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    Then "user-a" sees the federated visibility options enabled
