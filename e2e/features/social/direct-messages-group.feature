# CROSS-USER coverage — GROUP (3+ participant) direct messages (audit gap:
# direct-messages.feature is strictly 1:1 + bystander DENY; the VN view even
# ships an 8-sprite cap for group DMs, yet nothing proved a direct status
# mentioning TWO accounts reaches both).
#
# The honesty trap this feature pins: Mastodon direct reach is MENTION-BASED.
# A reply that keeps every mention reaches everyone; a reply that DROPS a
# mention silently stops reaching the dropped account — that narrowing is the
# real product behaviour and the DENY leg here proves it with the dropped
# persona live in their own context.
#
# HONESTY CONTRACT (inherited from direct-messages.feature):
#   - the group thread is created by a DIFFERENT persona (user-c) than both
#     observers; every reply is captured off the POST response (visibility
#     asserted 'direct') before any delivery claim;
#   - every DENY ("never appears") runs only AFTER the same scenario proved
#     the sibling delivery (the positive control), re-checked across reloads.
#
# @cluster — ships dark; the default config filters `not @cluster`.
@cluster @mastodon-ui @cross-user @social
Feature: Group direct messages — mention-based reach for three participants

  Scenario: a direct status mentioning two accounts reaches both conversations
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon"
    And "user-c" posts a direct status to "user-a" and "user-b" tagged "dm-group"
    Then the "dm-group" status appears in the conversations of "user-a" within 90 seconds
    And the "dm-group" status appears in the conversations of "user-b" within 90 seconds

  Scenario: a reply keeping every mention reaches all participants; dropping a mention drops that account
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon"
    And "user-c" posts a direct status to "user-a" and "user-b" tagged "dm-group-src"
    Then the "dm-group-src" status appears in the conversations of "user-a" within 90 seconds
    When "user-a" replies to the group conversation "dm-group-src" keeping mentions of "user-c" and "user-b" tagged "dm-group-keep"
    Then the "dm-group-keep" status appears in the conversations of "user-c" within 90 seconds
    And the "dm-group-keep" status appears in the conversations of "user-b" within 90 seconds
    When "user-a" replies to the group conversation "dm-group-src" mentioning only "user-c" tagged "dm-group-narrow"
    Then the "dm-group-narrow" status appears in the conversations of "user-c" within 90 seconds
    And the "dm-group-narrow" status never appears in the conversations of "user-b"
