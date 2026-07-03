# USER-SITUATIONAL coverage — Lists (lists-index.component.ts renders GET
# /api/v1/lists; the mastodon-timeline `list` source renders GET
# /api/v1/timelines/list/:id). The merged wave recorded lists as a PRODUCT gap
# ("only RENDERS existing lists; no create-list UI to seed one through") — this
# feature closes the TEST gap by seeding the list through the REAL homeserver
# API (POST /api/v1/lists, same hsproxy channel followViaApi uses) as a
# precondition, exactly like the follower-relationship seed, then driving the
# real Lists UI over it. The create-list UI itself remains a product gap; this
# does not invent one.
#
# HONESTY CONTRACT:
#   - the list is created via a REAL API call whose id is captured off the
#     response; the index/timeline assertions read that true id, never a
#     fabricated one.
#   - the list-timeline scenario proves the actual list feed: a member the owner
#     really follows (real follow seed) is added to the list (real add-member
#     call), that member posts a real status, and it is observed in the list
#     timeline — reach the home/public timelines would show regardless is NOT
#     what is asserted; the list route (/lists/:id) is.
#
# PERSONA SAFETY: the owner (user-a) FOLLOWS the member (user-c) — a user-a→
# user-c outbound follow, orthogonal to the inbound user-b→user-a / user-c↛
# user-a relationships post-visibility.feature relies on, so it cannot poison
# those preconditions on a live stack.
#
# @cluster — ships dark; the default config filters `not @cluster`. bddgen still
# compiles + lists every scenario.
@cluster @mastodon-ui @user-situational @social
Feature: Lists — the lists index and a list's own timeline

  Scenario: a created list shows in the lists index and links to its timeline
    Given "user-a" has a seeded session
    When "user-a" creates a mastodon list named "Close friends"
    And "user-a" navigates to "/social/mastodon/lists"
    Then "user-a" sees the "Close friends" list in the lists index
    And the "Close friends" list opens its list timeline when clicked

  Scenario: a list timeline carries a post from a member of that list
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" follows "user-c" on mastodon
    And "user-a" creates a mastodon list named "Reading" including "user-c"
    And "user-c" navigates to "/social/mastodon"
    And "user-c" posts a "public" status tagged "list-post"
    And "user-a" navigates to the "Reading" list timeline
    Then the "list-post" status appears in the "Reading" list timeline for "user-a" within 90 seconds
