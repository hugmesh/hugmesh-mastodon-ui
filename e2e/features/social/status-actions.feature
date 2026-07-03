# CROSS-USER coverage — the per-status action bar (toot-card.component.html):
# boost, favourite, bookmark, reply. Every status acted on here is created by a
# DIFFERENT persona than the one boosting/favouriting/bookmarking/replying
# (victim-creates-first), so a pass can never be explained by an actor
# observing their own content.
#
# HONESTY CONTRACT:
#   - BOOST is a REACH action: the booster's own home timeline shows the boost
#     (Mastodon's home-timeline contract includes self + follows), and the
#     ORIGINAL author observes the real reblogs_count climb — read off the
#     server, not the booster's optimistic local toggle.
#   - FAVOURITE and BOOKMARK are PRIVATE-to-actor lists (GET /api/v1/favourites
#     and /api/v1/bookmarks always scope to the caller). Each scenario proves
#     the ALLOW (the actor's own list carries it) THEN the DENY (no one else's
#     list ever does, re-checked across full reload cycles) — the honest
#     ALLOW+DENY pair for a privacy-scoped feature.
#   - REPLY posts a real child status and is observed both as a real
#     descendant on the parent's permalink thread and as an incremented reply
#     count on the parent, read by the parent's OWN author.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is
# needed. bddgen still compiles + lists every scenario.
@cluster @mastodon-ui @cross-user @social
Feature: Status actions — boost, favourite, bookmark and reply, observed cross-user

  Scenario: boosting another user's post reaches the booster's own timeline and the author sees the count climb
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "boost-src"
    Then the "boost-src" status appears in the federated timeline of "user-c" within 90 seconds
    When "user-c" boosts the "boost-src" status
    Then "user-c" sees their own boost of the "boost-src" status in their home timeline within 30 seconds
    And the "boost-src" status shows a boost count of 1 for "user-a" within 90 seconds

  Scenario: favouriting a post is visible only to the favouriter (ALLOW + DENY)
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "fav-src"
    Then the "fav-src" status appears in the federated timeline of "user-c" within 90 seconds
    When "user-c" favourites the "fav-src" status
    Then "user-c" sees the "fav-src" status in their favourites within 30 seconds
    And "user-a" never sees the "fav-src" status in their favourites
    And "user-b" never sees the "fav-src" status in their favourites

  Scenario: bookmarking a post is visible only to the bookmarker, even to the post's own author (ALLOW + DENY)
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "bookmark-src"
    Then the "bookmark-src" status appears in the federated timeline of "user-c" within 90 seconds
    When "user-c" bookmarks the "bookmark-src" status
    Then "user-c" sees the "bookmark-src" status in their bookmarks within 30 seconds
    And "user-a" never sees the "bookmark-src" status in their bookmarks

  Scenario: a reply from another user lands on the thread and increments the parent's reply count
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "reply-src"
    Then the "reply-src" status appears in the federated timeline of "user-c" within 90 seconds
    When "user-c" replies to the "reply-src" status tagged "reply-child"
    Then "user-a" sees the "reply-child" status among the replies to the "reply-src" status within 90 seconds
    And the reply count for the "reply-src" status reaches 1 for "user-a" within 90 seconds
