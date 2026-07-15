# OFFLINE / CLIENT-SIDE coverage — CHAT THEME COMBINATION SWEEP for the
# personal-only chat appearance group (appearance-panel.component.* Chat
# section → PreferencesService → data-mastodon-chat-* attributes +
# --mastodon-chat-accent-* CSS vars on the remote root — see styles.scss).
#
# Combination strategy (the tractable version of "all combinations"):
#   - SINGLE-AXIS EXHAUSTIVE: every value of every control exercised at least
#     once (bubbleShape ×3, chatFont ×4, chatDensity ×2, chatBackground ×4,
#     vnDialogSkin ×3) — one scenario per axis, the values looped
#     PROGRAMMATICALLY in the step (see chat-theme-steps.ts), not hand-written
#     per-case.
#   - SEEDED MULTI-AXIS: ~20 pseudo-random mixed configs from a FIXED-SEED
#     mulberry32 PRNG (deterministic across runs), each applied through the
#     real radio controls and asserted on all five root attributes at once.
#   - BOUNDARY COMBOS: all-first values, all-last values, and the "none"
#     boundary (Reset chat style → the built-in defaults).
#
# Like client-state.feature these run OFFLINE against the remote's dev-shell
# (`ng serve` + E2E_BASE_URL) — the appearance panel lives on the home timeline
# header and every assertion is a pure client-side attribute/var write, so no
# backend is needed; the preference PUT/GET is stubbed for determinism.
@mastodon-ui @offline @chat-theme
Feature: Chat theme sweep — every option and seeded combinations restyle the remote root

  Background:
    Given the preferences API is stubbed
    And a visitor opens the Home standalone page
    And the visitor opens the appearance panel

  Scenario: every bubble shape value applies its root attribute
    Then sweeping every "shape" chat option applies each root attribute value

  Scenario: every chat font value applies its root attribute
    Then sweeping every "font" chat option applies each root attribute value

  Scenario: every chat density value applies its root attribute
    Then sweeping every "density" chat option applies each root attribute value

  Scenario: every chat background value applies its root attribute
    Then sweeping every "background" chat option applies each root attribute value

  Scenario: every VN dialogue skin value applies its root attribute
    Then sweeping every "vnskin" chat option applies each root attribute value

  Scenario: the bubble colour pickers write validated accent CSS vars on the root
    When the visitor picks "#a1b2c3" for their own bubbles
    Then the root carries "#a1b2c3" as the mine accent var
    When the visitor picks "#0d0e0f" for the other side's bubbles
    Then the root carries "#0d0e0f" as the theirs accent var

  Scenario: 20 seeded pseudo-random mixed configs each apply all five chat attributes
    Then a seeded sweep of 20 mixed chat configs applies every root attribute combination

  Scenario: the boundary combos — all-first, all-last — apply cleanly
    Then the all-first boundary chat config applies every root attribute
    And the all-last boundary chat config applies every root attribute

  Scenario: reset returns the chat group to the built-in defaults (the none boundary)
    Then the all-last boundary chat config applies every root attribute
    When the visitor resets the chat style
    Then the root carries the built-in default chat attributes

  Scenario: a chosen chat config survives a reload (versioned localStorage)
    Then the all-last boundary chat config applies every root attribute
    When the visitor reloads the page
    Then the root carries the all-last boundary chat attributes without reopening the panel

  Scenario: the appearance panel fits a phone viewport and its Chat section scrolls into reach
    Given the viewport is a phone
    Then the appearance panel fits the viewport without horizontal page scroll
    And the Chat section can be scrolled into view inside the panel

  Scenario: the appearance panel fits a tablet viewport
    Given the viewport is a tablet
    Then the appearance panel fits the viewport without horizontal page scroll
