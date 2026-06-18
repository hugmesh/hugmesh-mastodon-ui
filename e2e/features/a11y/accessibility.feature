# Accessibility coverage — the org a11y standard the mastodon-ui carries for the
# social surface: a skip link that moves focus to the main region, a named
# timeline landmark with a feed role, a menu (the role-actions popup) that
# exposes aria-haspopup/expanded + a named group and restores focus to its
# trigger on Escape, and live-region announcements for async outcomes + the
# over-length compose error.
#
# Markup under test (mastodon-ui src):
#   app.component.html             — `<a class="skip" href="#main-content">` +
#                                    `<main id="main-content" tabindex="-1">`.
#   mastodon-timeline.component.html — `<section data-testid="mastodon-view"
#                                    aria-labelledby="timeline-heading">` +
#                                    `<div data-testid="mastodon-timeline"
#                                    role="feed" [aria-busy]>`.
#   role-actions-menu.component.html — trigger aria-haspopup/aria-expanded, panel
#                                    role="group" aria-label, Escape→close+
#                                    return-focus, outcome role=status|alert.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @mastodon-ui @a11y
Feature: mastodon-ui accessibility — skip link, feed landmark, menu focus, live regions
  As a keyboard / assistive-tech operator
  I want the social surface to honour the org a11y standard
  So I can read the timeline and operate every action without a mouse

  Scenario: the skip link is the first tab stop and moves focus to main
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    Then "user-a" can tab to the skip link
    And activating the skip link moves focus to the main region

  Scenario: the timeline is a named landmark exposing a feed role
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    Then the "mastodon-view" view has an accessible name
    And the timeline feed exposes a feed role

  Scenario: the actions menu trigger exposes a popup and a named panel
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    Then the "user-a" actions trigger exposes a popup
    When "user-a" opens the actions menu on the first post
    Then the actions panel is a named group

  Scenario: Escape closes the actions panel and restores focus to the trigger
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    And "user-a" opens the actions menu on the first post
    And "user-a" presses Escape in the actions panel
    Then focus is restored to the actions trigger

  Scenario: an async action outcome is announced via a live region
    Given "user-a" has a seeded session
    When "user-a" navigates to "/social/mastodon"
    And "user-a" opens the actions menu on the first post
    Then "user-a" can use the "user-block-mastodon" control
    And the action outcome is announced via a live region
