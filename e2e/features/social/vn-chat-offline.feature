# OFFLINE / CLIENT-SIDE coverage — VN CHAT MODE with a STUBBED conversation
# backend. The @cluster vn-chat-mode.feature proves the cross-user honesty
# contract on a live stack; THIS feature makes the whole VN presentation flow
# runnable headless with no cluster: the same-origin hsproxy endpoints the
# dev-shell service targets (/bff/user/mastodon/api/v1/conversations and
# /statuses/:id/context) are page.route-stubbed with a deterministic 3-message
# thread, while the SCENE MANIFEST + SVG assets are the REAL shipped files
# `ng serve` serves from assets/vn/scenes — so the picker sweep below exercises
# every real scene and prop, not fixtures.
#
# Combination strategy:
#   - SINGLE-AXIS EXHAUSTIVE: every one of the 6 shipped scenes selected once
#     (stage background follows), every one of the 8 shipped props toggled on
#     and off (stage prop layer follows) — looped programmatically in the step.
#   - BOUNDARY: thread navigation held at both ends (Prev disabled at oldest,
#     Next/Latest disabled at newest), the no-props boundary, and the
#     1000-char dialogue clamp with its keyboard-operable expander.
#   - The reduced-motion path is exercised via page emulation (the typewriter
#     class must be absent), plus phone/tablet viewport fit checks.
@mastodon-ui @offline @vn-chat
Feature: VN chat mode offline — stage, picker sweep, thread navigation, clamp, viewports

  Background:
    Given the conversations API is stubbed with a three-message direct thread
    And a visitor opens the Direct standalone page
    And the visitor enters VN mode on the stubbed conversation

  Scenario: the VN stage presents the thread opened at the newest message
    Then the VN stage and dialogue box are visible
    And the VN position reads "3 / 3"
    And the VN nameplate reads the third author

  Scenario: Prev/Next/Latest walk the stubbed thread and clamp honestly at both ends
    Then the VN position reads "3 / 3"
    And the VN "next" control is disabled
    And the VN "latest" control is disabled
    When the visitor presses the VN "prev" control
    And the visitor presses the VN "prev" control
    Then the VN position reads "1 / 3"
    And the VN "prev" control is disabled
    When the visitor presses the VN "latest" control
    Then the VN position reads "3 / 3"

  Scenario: every shipped scene is selectable and the stage background follows
    When the visitor opens the VN scene picker
    Then selecting each shipped scene updates the stage background in turn

  Scenario: every shipped prop toggles onto and off the stage
    When the visitor opens the VN scene picker
    Then toggling each shipped prop adds it to and removes it from the stage

  Scenario: reduced motion disables the typewriter reveal
    Given the visitor prefers reduced motion
    When the visitor reloads into VN mode on the stubbed conversation
    Then the VN dialogue text renders without the typewriter animation

  Scenario: an over-long message is clamped with a keyboard-operable expander
    Given the conversations API is stubbed with an over-long direct message
    And a visitor opens the Direct standalone page
    And the visitor enters VN mode on the stubbed conversation
    Then the VN dialogue text is clamped near 1000 characters
    When the visitor expands the clamped message with the keyboard
    Then the VN dialogue text shows the full message

  Scenario: focus is not trapped by the VN presentation
    Then keyboard focus can travel from the VN navigation into the reply composer

  Scenario: the VN view stacks inside a phone viewport
    Given the viewport is a phone
    Then there is no horizontal page scroll
    And the VN stage letterboxes inside the viewport
    And the VN navigation controls are fully inside the viewport

  Scenario: the VN view fits a tablet viewport
    Given the viewport is a tablet
    Then there is no horizontal page scroll
    And the VN stage letterboxes inside the viewport

  Scenario: the VN view fits a tablet landscape viewport
    Given the viewport is a tablet in landscape
    Then there is no horizontal page scroll
    And the VN stage letterboxes inside the viewport
