# VN CHAT MODE — visual-novel presentation of a direct-message conversation
# (vn-chat-view.component.ts behind the per-conversation
# data-testid="conversation-vn-toggle" in the Conversations column). The stage
# is built ENTIRELY from shipped local assets (assets/vn/scenes — SceneService)
# plus the conversation's own accounts/statuses; message bodies pass through the
# SAME DOMPurify gate as toot-card, so nothing here widens the federated-HTML
# surface.
#
# HONESTY CONTRACT:
#   - the conversation asserted here is created by a DIFFERENT persona than the
#     observer (user-c direct-messages user-a), same as direct-messages.feature —
#     a pass can never be explained by the observer seeing their own draft.
#   - the thread-navigation scenario asserts on REAL ordered statuses it created
#     itself (two tagged messages), not on pre-seeded fixtures.
#   - the scene-persistence scenario proves the durable half (the choice
#     survives a full reload — localStorage + GET/PUT /bff/user/preferences),
#     not merely the same-page signal update.
#   - the VN reply is a REAL child status: the step captures the POST response
#     and asserts visibility=direct + in_reply_to_id set before believing it,
#     then observes it land in the original sender's Conversations.
#
# @cluster — ships dark; the default config filters `not @cluster` so no live
# stack is needed. bddgen still compiles + lists every scenario. Un-tag once the
# env-test-build live wiring lands (same lifecycle as every other @cluster
# feature here).
@cluster @mastodon-ui @cross-user @social
Feature: VN chat mode — a direct conversation presented as a visual novel

  Background:
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    And "user-c" posts a direct status to "user-a" tagged "vn-seed"
    And the "vn-seed" status appears in the conversations of "user-a" within 90 seconds

  Scenario: toggling VN mode swaps the conversation into the visual-novel stage and back
    When "user-a" navigates to "/social/mastodon/direct"
    And "user-a" toggles VN mode on the "vn-seed" conversation
    Then the VN toggle of the "vn-seed" conversation reads pressed
    And the visual-novel stage is shown for the "vn-seed" conversation
    And the VN dialogue box shows the "vn-seed" message attributed to "user-c"
    And a participant sprite for "user-c" is highlighted as the speaker
    When "user-a" toggles VN mode on the "vn-seed" conversation
    Then the classic conversation row is shown for the "vn-seed" conversation

  Scenario: Prev/Next/Latest walk the real thread one message at a time
    Given "user-c" replies to the "vn-seed" conversation tagged "vn-step-2"
    And the "vn-step-2" status appears in the conversations of "user-a" within 90 seconds
    When "user-a" navigates to "/social/mastodon/direct"
    And "user-a" toggles VN mode on the "vn-seed" conversation
    Then the VN dialogue box shows the "vn-step-2" message
    When "user-a" presses the VN "Prev" control
    Then the VN dialogue box shows the "vn-seed" message
    And the VN "Prev" control is disabled at the oldest message
    When "user-a" presses the VN "Latest" control
    Then the VN dialogue box shows the "vn-step-2" message

  Scenario: the scene and prop choice is personal and survives a full reload
    When "user-a" navigates to "/social/mastodon/direct"
    And "user-a" toggles VN mode on the "vn-seed" conversation
    And "user-a" opens the VN scene picker
    And "user-a" picks the "Night city" scene
    And "user-a" enables the "Lamp" prop
    Then the VN stage background is the "Night city" scene
    When "user-a" reloads the page
    And "user-a" toggles VN mode on the "vn-seed" conversation
    Then the VN stage background is the "Night city" scene
    And the "Lamp" prop is on the VN stage

  Scenario: replying from the VN dialogue seam delivers a real direct reply to the sender
    When "user-a" navigates to "/social/mastodon/direct"
    And "user-a" toggles VN mode on the "vn-seed" conversation
    And "user-a" replies from the VN reply seam tagged "vn-reply"
    Then the captured "vn-reply" POST response has visibility "direct" and a set in_reply_to_id
    And the VN dialogue box shows the "vn-reply" message
    And the "vn-reply" status appears in the conversations of "user-c" within 90 seconds
