# USER-SITUATIONAL coverage — the account-profile Follow control
# (account-profile.component.html `account-follow-btn`), driven through a REAL
# UI click (the merged post-visibility.feature only ever seeds a follow via the
# raw-API `followViaApi` helper as a PRECONDITION; this proves the button
# itself works end to end). The real consequence pinned here: Mastodon's home
# timeline only ever carries posts from accounts you follow (+ yourself),
# REGARDLESS of that post's own visibility — so following/unfollowing is
# itself the ALLOW/DENY gate on home-timeline reach, distinct from the
# post-visibility matrix (which gates reach by the POST's chosen visibility).
#
# PERSONA NOTE: "locked-user" is the actor here (not user-b/user-c/user-victim)
# — those personas already carry load-bearing follow-relationship meaning in
# other merged/wave features (post-visibility's accepted-follower vs.
# non-follower controls, notifications.feature's follow-notification actor,
# mod-consequences' irreversible destructive-action target) that a stray
# follow/unfollow here would silently corrupt on a live, non-reseeded stack.
# locked-user's domain-lock restricts only their own OUTBOUND post reach, not
# who they may follow, so this is a safe, uncommitted persona for the demo.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is
# needed. bddgen still compiles + lists every scenario.
@cluster @mastodon-ui @user-situational
Feature: Follow — the profile follow control actually gates home-timeline reach

  Scenario: following via the UI grants home-timeline reach; unfollowing revokes it going forward (ALLOW + DENY)
    Given "user-a" has a seeded session in their own context
    And "locked-user" has a seeded session in their own context
    When "locked-user" navigates to the profile of "user-a"
    Then "locked-user" sees the follow button labelled "Follow" for "user-a"
    When "locked-user" clicks the follow button for "user-a"
    Then "locked-user" sees the follow button labelled "Following" for "user-a"
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "follow-ui-reach"
    Then the "follow-ui-reach" status appears in the home timeline of "locked-user" within 90 seconds
    When "locked-user" navigates to the profile of "user-a"
    And "locked-user" clicks the follow button for "user-a"
    Then "locked-user" sees the follow button labelled "Follow" for "user-a"
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "follow-ui-after-unfollow"
    Then the "follow-ui-after-unfollow" status appears in the home timeline of "user-a" within 30 seconds
    And the "follow-ui-after-unfollow" status never appears in the home timeline of "locked-user"
