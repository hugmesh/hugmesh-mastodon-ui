# CROSS-USER coverage — the Notifications column (notifications-column.
# component.ts), which the merged waves never exercised. Covers the four
# status/relationship-driven types the component actually renders
# (NotificationsColumnComponent.verb(): mention / favourite / reblog / follow),
# the type-filter chips, and dismiss / clear-all.
#
# HONESTY CONTRACT:
#   - every notification is triggered by a REAL action from a DIFFERENT
#     persona than the recipient (victim-creates-first: the recipient's own
#     status is created first, then a different actor mentions/favourites/
#     boosts it, or follows them) — a pass can never be explained by the
#     recipient noticing their own activity.
#   - the mention scenario pairs the ALLOW (the mentioned account sees it)
#     with a DENY (an uninvolved bystander's own mailbox never carries it) —
#     mailbox scoping, asserted with a real bystander live in the scenario,
#     not merely assumed.
#   - "mod-a" is the follow-notification actor (not user-b/user-c/locked-user)
#     because those personas already carry LOAD-BEARING follow-relationship
#     meaning in merged/other-wave features (post-visibility's accepted
#     follower vs. non-follower, follow.feature's UI-follow demo); mod-a
#     carries no such reservation.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is
# needed. bddgen still compiles + lists every scenario.
@cluster @mastodon-ui @cross-user @social
Feature: Notifications — cross-user delivery, honest mailbox scoping, filters and dismissal

  Scenario: a mention notifies the mentioned account, never an uninvolved bystander
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon"
    And "user-c" posts a "public" status mentioning "user-a" tagged "notif-mention"
    Then "user-a" sees a "mention" notification from "user-c" for the "notif-mention" status within 90 seconds
    And "user-b" never sees a "mention" notification from "user-c" for the "notif-mention" status

  Scenario: a favourite notifies the post's author
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "notif-fav"
    And "user-c" favourites the "notif-fav" status
    Then "user-a" sees a "favourite" notification from "user-c" for the "notif-fav" status within 90 seconds

  Scenario: a boost notifies the post's author
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "notif-boost"
    And "user-c" boosts the "notif-boost" status
    Then "user-a" sees a "boost" notification from "user-c" for the "notif-boost" status within 90 seconds

  Scenario: a new follower notifies the followed account
    Given "user-a" has a seeded session in their own context
    And "mod-a" has a seeded session in their own context
    When "mod-a" follows "user-a" on mastodon
    Then "user-a" sees a "follow" notification from "mod-a" within 90 seconds

  Scenario: the type-filter chips isolate one notification type from a mixed inbox
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "notif-filter"
    And "user-c" favourites the "notif-filter" status
    And "user-c" boosts the "notif-filter" status
    Then "user-a" sees a "favourite" notification from "user-c" for the "notif-filter" status within 90 seconds
    And "user-a" sees a "boost" notification from "user-c" for the "notif-filter" status within 90 seconds
    When "user-a" selects the "Favourites" notification filter
    Then every visible notification for "user-a" has type "favourite"
    When "user-a" selects the "Boosts" notification filter
    Then every visible notification for "user-a" has type "boost"

  Scenario: dismissing one notification removes only that one; clear-all empties the inbox
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "notif-dismiss-a"
    And "user-a" posts a "public" status tagged "notif-dismiss-b"
    And "user-c" favourites the "notif-dismiss-a" status
    And "user-c" boosts the "notif-dismiss-b" status
    Then "user-a" sees a "favourite" notification from "user-c" for the "notif-dismiss-a" status within 90 seconds
    And "user-a" sees a "boost" notification from "user-c" for the "notif-dismiss-b" status within 90 seconds
    When "user-a" dismisses the notification from "user-c" for the "notif-dismiss-a" status
    Then "user-a" never sees a "favourite" notification from "user-c" for the "notif-dismiss-a" status
    And "user-a" sees a "boost" notification from "user-c" for the "notif-dismiss-b" status within 30 seconds
    When "user-a" clears all notifications
    Then "user-a" sees no notifications
