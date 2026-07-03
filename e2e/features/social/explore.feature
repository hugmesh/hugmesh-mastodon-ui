# USER-SITUATIONAL coverage — Explore (explore.component.ts): the trending
# Posts / Hashtags / News tabs, each backed by a DISTINCT homeserver endpoint
# (GET /api/v1/trends/{statuses,tags,links}). The merged wave DELIBERATELY
# skipped asserting trending CONTENT — which item trends is computed by the
# homeserver from real cross-account engagement over time and cannot be made
# deterministic inside one e2e run (a content assertion would be flaky or
# vacuous). This feature covers the part that IS deterministic and was still
# uncovered: selecting each tab drives its OWN trends endpoint (the select step
# arms a waitForResponse on that exact endpoint before clicking — the same
# real-request-observation pattern search.feature uses) and swaps the rendered
# panel. That endpoint round-trip needs a live stack, so it ships @cluster; the
# pure client-side tab TOGGLE (no backend) is covered offline in
# client-state.feature.
#
# @cluster — ships dark; the default config filters `not @cluster`. bddgen still
# compiles + lists every scenario.
@cluster @mastodon-ui @user-situational @social
Feature: Explore — trending tabs each drive their own endpoint and panel

  Scenario: each trending tab requests its matching trends endpoint and shows its panel
    Given "user-a" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon/explore"
    Then "user-a" sees the "posts" trending panel
    When "user-a" selects the "tags" trending tab and its trends endpoint responds
    Then "user-a" sees the "tags" trending panel
    When "user-a" selects the "links" trending tab and its trends endpoint responds
    Then "user-a" sees the "links" trending panel
