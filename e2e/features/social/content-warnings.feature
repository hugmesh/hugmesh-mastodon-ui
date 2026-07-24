# CROSS-USER coverage — CONTENT WARNINGS and SENSITIVE MEDIA (audit gap: the
# compose CW input and the toot-card CW collapse ship with testids but no
# scenario ever proved a DIFFERENT user sees a spoilered status collapsed; the
# sensitive-media leg also gates the fixed no-reveal defect — a sensitive
# attachment WITHOUT spoiler text previously had no reveal control at all).
#
# HONESTY CONTRACT:
#   - author and observer are DIFFERENT personas in their own contexts;
#   - the CW status is believed only off the POST response echoing the
#     spoiler_text; the sensitive status is believed only off the POST response
#     echoing sensitive:true with a media attachment;
#   - "hidden" is asserted as the BODY MARKER ABSENT from the rendered card
#     (not merely a class), and the reveal asserts the marker present +
#     aria-expanded=true, then Show less re-hides it;
#   - the sensitive-media seed uploads a REAL (in-page generated) PNG through
#     the raw compose API from the author's cookie-authed session — API
#     seeding for the OBSERVED surface, which is the observer's reveal control.
#
# @cluster — ships dark; the default config filters `not @cluster`.
@cluster @mastodon-ui @cross-user @social
Feature: Content warnings and sensitive media — collapsed for other users until revealed

  Scenario: a spoilered status reaches another user collapsed, expands, and re-collapses
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a spoilered status tagged "cw-test" with a hidden body
    Then the spoilered "cw-test" status appears collapsed in the federated timeline of "user-c" within 90 seconds
    When "user-c" expands the "cw-test" content warning
    Then the "cw-test" hidden body is visible to "user-c"
    When "user-c" collapses the "cw-test" content warning
    Then the "cw-test" hidden body is hidden again for "user-c"

  Scenario: sensitive media without a spoiler is blurred for another user and reveals via Show media
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" seeds a sensitive image status tagged "cw-sensitive" through the compose API
    Then the sensitive "cw-sensitive" media appears blurred with a "Show media" control in the federated timeline of "user-c" within 90 seconds
    When "user-c" clicks the "Show media" control on the "cw-sensitive" status
    Then the "cw-sensitive" media is revealed for "user-c"
