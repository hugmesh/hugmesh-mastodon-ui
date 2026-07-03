# CROSS-USER coverage — Direct messages / Conversations
# (conversations-column.component.ts, GET /api/v1/conversations + the inline
# direct-visibility reply composer), which no merged wave exercised. The
# DirectTimeline is a per-owner mailbox: a `direct` status reaches ONLY the
# accounts it addresses, so the conversation surface is the honest place to
# prove that reach tier from the RECIPIENT'S side (post-visibility.feature
# proves the direct visibility exists; this proves the Conversations UI renders
# it and lets the recipient reply privately).
#
# HONESTY CONTRACT:
#   - every conversation asserted here is created by a DIFFERENT persona than
#     the observer (user-c direct-messages user-a) — a pass can never be
#     explained by the observer seeing their own outbound draft.
#   - the ALLOW (the addressed recipient's Conversations carries it, attributed
#     to the real sender) is paired with a DENY (an un-addressed bystander's own
#     Conversations never carries it) — mailbox scoping asserted with a real
#     bystander live in the scenario, not assumed.
#   - the reply is a REAL child status: the step captures the POST response and
#     asserts visibility=direct + in_reply_to_id set before believing it, then
#     observes it land in the original sender's Conversations.
#
# @cluster — ships dark; the default config filters `not @cluster` so no live
# stack is needed. bddgen still compiles + lists every scenario. Un-tag once the
# env-test-build live wiring lands (same lifecycle as every other @cluster
# feature here).
@cluster @mastodon-ui @cross-user @social
Feature: Direct messages — cross-user delivery, honest mailbox scoping, private reply

  Scenario: a direct message reaches the addressee attributed to its sender, never an un-addressed bystander
    Given "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon"
    And "user-c" posts a direct status to "user-a" tagged "dm-scope"
    Then the "dm-scope" status appears in the conversations of "user-a" within 90 seconds
    And "user-a" sees the "dm-scope" conversation attributed to "user-c"
    And the "dm-scope" status never appears in the conversations of "user-b"

  Scenario: the recipient replies privately from the conversation and the reply reaches the sender
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon"
    And "user-c" posts a direct status to "user-a" tagged "dm-reply-src"
    Then the "dm-reply-src" status appears in the conversations of "user-a" within 90 seconds
    When "user-a" replies privately to the "dm-reply-src" conversation tagged "dm-reply"
    Then the "dm-reply" status appears in the conversations of "user-c" within 90 seconds
