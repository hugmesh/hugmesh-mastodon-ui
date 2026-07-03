# USER-SITUATIONAL coverage — extends platform-role-access.feature (which only
# proves the "user-block-mastodon"/"user-recommend-instance" controls RENDER
# enabled) with a REAL click and the honest-envelope disclosure, mirroring the
# mod-consequences pattern one tier down: the USER-tier self-block
# (role-actions-menu.component.ts `blockUser`) actually fires POST
# /bff/user/blocks, and the live region relays the REAL envelope, never a bare
# "done".
#
# The 'internal' platform is used for the ALLOW case specifically because it
# is UNCONDITIONALLY `external: n/a` on every deployment — user-bff-api's
# BlockService only attempts an external push for 'matrix'/'mastodon', and
# whether THAT push is live depends on a `block.mastodon.enabled` runtime flag
# this wave cannot assume (see mod-consequences.feature's own
# HONEST-FAILURE-NOTE for the analogous mod-tier case). 'internal' has no such
# ambiguity, so this is a fully deterministic assertion.
#
# The self-block targets the DEDICATED "user-victim" persona (their post is the
# resource acted on — victim-creates-first) — a USER-tier self-block is
# CLIENT-scoped only ("These actions affect only what you see" — the panel's
# own tier-user-help text), so unlike the mod-tier server-wide block/ban, it
# cannot poison user-victim for mod-consequences.feature's later use of that
# persona.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is
# needed. bddgen still compiles + lists every scenario.
@cluster @mastodon-ui @user-situational
Feature: USER-tier self-block — a real click, honestly disclosed

  Scenario: an internal-only self-block is recorded with an honest no-external-push disclosure (ALLOW)
    Given "user-a" has a seeded session in their own context
    And "user-victim" has a seeded session in their own context
    When "user-victim" navigates to "/social/mastodon"
    And "user-victim" posts a "public" status tagged "self-block-src"
    Then the "self-block-src" status appears in the federated timeline of "user-a" within 90 seconds
    When "user-a" opens the actions menu on the "self-block-src" status
    And "user-a" clicks the "user-block-internal" control in the actions panel
    Then "user-a" sees the safety outcome disclosed as an internal-only block

  Scenario: recommending an instance block is disabled for a local account (no instance to recommend)
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    And "user-a" opens the actions menu on the first post
    Then "user-a" sees the "user-recommend-instance" control disabled for a local account
