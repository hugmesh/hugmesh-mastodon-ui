# USER-SITUATIONAL coverage — Lists (lists-index.component.ts renders GET
# /api/v1/lists + now CREATES via POST /api/v1/lists from its own control; the
# mastodon-timeline `list` source renders GET /api/v1/timelines/list/:id). The
# earlier wave recorded lists as a PRODUCT gap ("only RENDERS existing lists; no
# create-list UI"). That gap is now CLOSED: the create-list control ships, so the
# first scenario drives the REAL UI (fill the title, click "Create list", capture
# the created list's true id off the POST response) instead of the raw-API seed.
# The list-timeline scenario still API-seeds the MEMBER-ADD (there is no add-to-
# list UI yet — a separate, still-open gap), exactly like the follower seed.
#
# HONESTY CONTRACT:
#   - the list is created through the real control and its id is captured off the
#     POST response; the index/timeline assertions read that true id, never a
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

  Scenario: creating a list from the in-app control shows it in the index and links to its timeline
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon/lists"
    And "user-a" creates a list titled "Close friends" using the create-list control
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
