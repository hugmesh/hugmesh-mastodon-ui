# USER-SITUATIONAL coverage — the ROLE_MASTODON platform access gate + the
# role-tiered action surface, ALLOW + DENY + disabled+helptext.
#
# The mastodon-ui is a native-federation REMOTE the host mounts at
# /social/mastodon ONLY for a session carrying the ROLE_MASTODON platform role
# (the host's social guard). A role-absent user is bounced to /login. Within the
# remote, the role-actions menu renders three ADDITIVE tiers driven by
# SessionService.isUser/isMod/isAdmin:
#   tier-user  — every authed user (self-block + recommend-instance-block).
#   tier-mod   — mod OR admin (server-wide block + moderation queue).
#   tier-admin — admin only; decide (approve/deny) is wired to admin-bff-api's
#                POST /bff/admin/moderation/{id}/decide (mastodon-ui#36), NOT a
#                stub. The scenario below asserts the real decide-effect
#                disclosure text (role-actions-menu.component.html's
#                admin-stub-note no longer carries a data-stub attribute).
#
# @cluster — wave 2b ships DARK. These need the host shell serving the federated
# remote + a live session (and a rendered toot for the menu to mount on), so
# they're tagged @cluster and the config filters them out (`tags: 'not @cluster'`)
# so the default run requires no live stack. They still COMPILE + DISCOVER (a
# no-filter bddgen + `playwright test --list` proves it) — unlike playwright-bdd's
# reserved @skip, which drops a scenario from generation entirely.
@cluster @mastodon-ui @user-situational
Feature: Mastodon social surface — platform-role access and role-tiered actions
  As the hugmesh.systems host mounting the Mastodon remote
  I must admit only ROLE_MASTODON sessions and show each action tier only to its role
  So the social surface and its moderation powers never leak to an under-privileged user

  Scenario: a ROLE_MASTODON user reaches the social timeline (ALLOW)
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    Then "user-a" sees the "mastodon-view" view

  Scenario: a user without ROLE_MASTODON is bounced from the social surface (DENY)
    Given "no-mastodon" has a seeded session
    When "no-mastodon" navigates to "/social/mastodon"
    Then "no-mastodon" is redirected to the login page

  Scenario: a plain social user gets only the USER tier (ALLOW + DENY floor)
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    And "user-a" opens the actions menu on the first post
    Then "user-a" sees the "tier-user" tier
    And "user-a" can use the "user-block-mastodon" control
    And "user-a" does not see the "tier-mod" tier
    And "user-a" does not see the "tier-admin" tier

  Scenario: a mod gets the USER and MOD tiers but never the ADMIN tier
    Given "mod-a" has a seeded session
    When "mod-a" navigates to "/social/mastodon"
    And "mod-a" opens the actions menu on the first post
    Then "mod-a" sees the "tier-user" tier
    And "mod-a" sees the "tier-mod" tier
    And "mod-a" can use the "mod-block-user" control
    And "mod-a" does not see the "tier-admin" tier

  Scenario: an admin gets all three tiers, with the real decide-effect disclosure
    Given "admin-a" has a seeded session
    When "admin-a" navigates to "/social/mastodon"
    And "admin-a" opens the actions menu on the first post
    Then "admin-a" sees the "tier-user" tier
    And "admin-a" sees the "tier-mod" tier
    And "admin-a" sees the "tier-admin" tier
    And "admin-a" sees the admin decide-effect disclosure
