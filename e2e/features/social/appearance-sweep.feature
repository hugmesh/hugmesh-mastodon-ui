# OFFLINE / CLIENT-SIDE coverage — the NON-CHAT appearance preference sweep
# (audit gap: chat-theme-sweep.feature covers ONLY the chat group; the ten main
# appearance controls, the full "Reset to default" and their reload persistence
# had zero coverage despite identical offline testability). This closes the
# audit's 13-flagged-preferences list for every control that exists offline:
# theme, accent, light/dark/auto, layout, density, media corners, font, text
# size, high contrast, reduced motion, and the all-groups reset (the remaining
# two flagged prefs — the ADMIN org default and the AI-cloak default — live in
# appearance-org-default.feature and media-cloak-offline.feature).
#
# Same conventions as chat-theme-sweep.feature: runs against the remote's
# dev-shell (`ng serve` + E2E_BASE_URL), the preference PUT/GET stubbed for
# determinism, every assertion a REAL data-mastodon-* attribute (or CSS var)
# on the remote root that PreferencesService stamps.
@mastodon-ui @offline @appearance
Feature: Appearance sweep — every main appearance control restyles the remote root and survives a reload

  Background:
    Given the preferences API is stubbed
    And a visitor opens the Home standalone page
    And the visitor opens the appearance panel

  Scenario: every colour theme value applies its root attribute
    Then sweeping every "theme" appearance option applies each root attribute value

  Scenario: every accent value applies its root attribute
    Then sweeping every "accent" appearance option applies each root attribute value

  Scenario: every light-dark-auto value applies its root attribute
    Then sweeping every "appearance" appearance option applies each root attribute value

  Scenario: every layout value applies its root attribute
    Then sweeping every "layout" appearance option applies each root attribute value

  Scenario: every density value applies its root attribute
    Then sweeping every "density" appearance option applies each root attribute value

  Scenario: every media-corners value applies its root attribute
    Then sweeping every "corners" appearance option applies each root attribute value

  Scenario: every font value applies its root attribute
    Then sweeping every "font" appearance option applies each root attribute value

  Scenario: every text size applies its root attribute and its rem CSS variable
    Then sweeping every "textsize" appearance option applies each root attribute value
    And each text size writes its expected --mastodon-text-size value

  Scenario: the high-contrast and reduced-motion toggles stamp and clear their root attributes
    When the visitor turns the "toggle-contrast" accessibility toggle on
    Then the root carries the "data-mastodon-contrast" attribute as "on"
    When the visitor turns the "toggle-contrast" accessibility toggle off
    Then the root does not carry the "data-mastodon-contrast" attribute
    When the visitor turns the "toggle-motion" accessibility toggle on
    Then the root carries the "data-mastodon-motion" attribute as "on"
    When the visitor turns the "toggle-motion" accessibility toggle off
    Then the root does not carry the "data-mastodon-motion" attribute

  Scenario: a mixed non-default appearance survives a full reload without reopening the panel
    When the visitor applies the all-last non-default appearance config
    And the visitor reloads the page
    Then the root carries the all-last appearance attributes without reopening the panel

  Scenario: Reset to default restores every built-in appearance attribute (including the chat group)
    When the visitor applies the all-last non-default appearance config
    And the visitor resets all appearance settings to default
    Then the root carries the built-in default appearance attributes
    And the root carries the built-in default chat attributes
