# CROSS-USER coverage — THREAD-VIEW REPLY VISIBILITY INHERITANCE. This feature
# GATES the fixed HIGH privacy defect: status-detail.component.html mounted the
# reply composer WITHOUT [defaultVisibility], so replying to a followers-only
# or direct status from the thread view pre-selected Public — an accidental
# privacy-widening path (the conversations column always passed
# defaultVisibility="direct"; the thread view, reachable from a mention
# notification on a private thread, did not inherit anything).
#
# PERSONA GEOMETRY (status ids are instance-local, so the follower must live on
# the author's OWN homeserver): the author is "user-c" (domain-a) and the
# follower is "user-a" (domain-a). user-a FOLLOWING user-c is a fresh edge no
# other feature reserves (the load-bearing reservations are user-b = accepted
# follower OF user-a and user-c = NON-follower OF user-a — both untouched).
#
# HONESTY CONTRACT:
#   - the private parent is believed only off its POST response
#     (visibility=private) and its follower reach is positively proven (home
#     timeline) BEFORE any composer claim;
#   - the composer assertion reads the REAL <select> value on the thread view;
#   - the posted reply's privacy is proven by ITS OWN POST response
#     (visibility=private + in_reply_to_id=parent) AND by the signed-out
#     public-timeline DENY (post-positive-control: the reply was just created
#     and observed as a thread descendant).
#
# @cluster — ships dark; the default config filters `not @cluster`.
@cluster @mastodon-ui @cross-user @social
Feature: Reply visibility inheritance — a private or direct thread never defaults a reply to Public

  Scenario: replying to a followers-only status from the thread view pre-selects Followers and posts private
    Given "user-c" has a seeded session in their own context
    And "user-a" has a seeded session in their own context
    And "user-a" follows "user-c" on mastodon
    When "user-c" navigates to "/social/mastodon"
    And "user-c" posts a "private" status tagged "rvi-src"
    Then the "rvi-src" status appears in the home timeline of "user-a" within 90 seconds
    When "user-a" opens the thread view of the "rvi-src" status
    Then the thread reply composer visibility reads "private" for "user-a"
    When "user-a" posts the thread reply tagged "rvi-reply"
    Then the captured "rvi-reply" reply is private and threaded to "rvi-src"
    And "user-a" sees the "rvi-reply" status among the thread descendants
    And the signed-out public timeline never shows the "rvi-reply" status

  Scenario: replying to a direct status from the thread view pre-selects Direct
    Given "user-c" has a seeded session in their own context
    And "user-a" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon"
    And "user-c" posts a direct status to "user-a" tagged "rvi-dm"
    Then the "rvi-dm" status appears in the conversations of "user-a" within 90 seconds
    When "user-a" opens the thread view of the "rvi-dm" status
    Then the thread reply composer visibility reads "direct" for "user-a"
