# CROSS-USER / MULTI-CONTEXT coverage — the Akkoma post-visibility matrix
# (public | unlisted | private | direct) proven by OBSERVATION, not by trusting
# the composer: every scenario creates a REAL status through the composer
# (capturing the real id/visibility off the POST response), then observes it —
# or its honest ABSENCE — from other personas' contexts, from a cross-domain
# session, and from the RAW unauthenticated public timeline (the signed-out
# oracle; the host social guard bounces a signed-out browser before any UI
# renders, so the raw homeserver endpoint IS what an anonymous visitor gets).
#
# HONESTY: negative ("never appears") steps only run AFTER the same scenario
# proved the status was delivered somewhere (a positive control), and they
# re-check across full reload+settle cycles — no fabricated ids, no sleeps.
# The cross-domain observer is "user-b" (domain-B): their session rides
# domain-B's homeserver through the BFF hsproxy, so what they can see is
# exactly what FEDERATED. The same-domain observer is "user-c" (status ids are
# instance-local, so permalink positive controls need a same-server session).
#
# @cluster — needs the host + login remote + user-bff hsproxy + a federating
# homeserver pair; ships dark (config filters `not @cluster`), bddgen still
# compiles + lists every scenario.
@cluster @mastodon-ui @cross-user @federation
Feature: Akkoma post visibility — each reach tier is observable exactly by its audience
  As the federated social platform
  I must deliver each post exactly to the audience its visibility promises
  So a poster's reach is never silently wider or narrower than what they chose

  Scenario: a public post is visible to another user and to the signed-out public timeline
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "pv-public"
    Then the "pv-public" status appears in the home timeline of "user-a" within 30 seconds
    And the "pv-public" status appears in the federated timeline of "user-b" within 90 seconds
    And the signed-out public timeline shows the "pv-public" status within 30 seconds

  Scenario: an unlisted post is reachable by permalink but stays off the public timelines
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts an "unlisted" status tagged "pv-unlisted"
    Then the "pv-unlisted" status appears in the home timeline of "user-a" within 30 seconds
    And "user-c" sees the "pv-unlisted" status on its permalink
    And the "pv-unlisted" status never appears in the federated timeline of "user-c"
    And the signed-out public timeline never shows the "pv-unlisted" status

  Scenario: a private post reaches only an accepted follower
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    And "user-b" follows "user-a" on mastodon
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "private" status tagged "pv-private"
    Then the "pv-private" status appears in the home timeline of "user-b" within 90 seconds
    And the "pv-private" status never appears in the home timeline of "user-c"
    And the "pv-private" status never appears in the federated timeline of "user-c"
    And the signed-out public timeline never shows the "pv-private" status
    And the anonymous permalink for the "pv-private" status is denied

  Scenario: a direct post is visible only to the mentioned account
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a direct status to "user-b" tagged "pv-direct"
    Then the "pv-direct" status appears in the conversations of "user-b" within 90 seconds
    And the "pv-direct" status never appears in the home timeline of "user-c"
    And the signed-out public timeline never shows the "pv-direct" status

  Scenario: a cross-domain observer sees federated public reach only
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "xd-public"
    And "user-a" posts an "unlisted" status tagged "xd-unlisted"
    Then the "xd-public" status appears in the home timeline of "user-a" within 30 seconds
    And the "xd-unlisted" status appears in the home timeline of "user-a" within 30 seconds
    And the "xd-public" status appears in the federated timeline of "user-b" within 90 seconds
    And the "xd-unlisted" status never appears in the federated timeline of "user-b"
    And the "xd-unlisted" status never appears in the home timeline of "user-b"
