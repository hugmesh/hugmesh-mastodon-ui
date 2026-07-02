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

  Scenario: a signed-out visitor is bounced from the social surface and sees no moderation controls
    # The RBAC floor below every role: NO session at all. The host social guard
    # must bounce the navigation to /login, and — defence in depth — the page a
    # signed-out visitor ends up on must carry ZERO role-actions menus (the
    # component's showMenu() gate is isUser(), false with no session).
    Given "signed-out" has a signed-out context
    When "signed-out" navigates to "/social/mastodon"
    Then "signed-out" is redirected to the login page
    # ↑ the redirect is the LOAD-BEARING deny. The count below runs on the
    # post-redirect (login) page, so it is defence-in-depth decoration only:
    # it pins that the landing page carries zero role-actions menus, but it
    # cannot probe a menu leak on the social page itself — a guard that
    # leaked the social page would already have failed the redirect above.
    And "signed-out" sees no role-actions menu

  Scenario: a superadmin reaches the MOD tier and the queue across domains (SUPERADMIN gating)
    # SUPERADMIN is the cross-domain infra control plane: mod-bff admits it via
    # hasAnyRole('MOD','ADMIN','SUPERADMIN') with the DomainScope null predicate
    # (no per-brand filter), and the UI role tiers light up because Casdoor
    # grants 'admin' alongside 'superadmin'. ALLOW pair for the SUPERADMIN row
    # of the role matrix — the DENY floor is already held by user-a above.
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/social/mastodon"
    And "superadmin" opens the actions menu on the first post
    Then "superadmin" sees the "tier-mod" tier
    And "superadmin" can use the "mod-load-queue" control
    When "superadmin" GETs "/bff/mod/moderation"
    Then the response status is 200
