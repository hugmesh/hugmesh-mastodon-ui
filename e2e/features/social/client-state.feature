# OFFLINE / CLIENT-SIDE coverage — pure signal-driven UI state that renders and
# transitions with NO backend at all. These scenarios drive the remote's own
# dev-shell (app.routes.ts mounts the exposed Mastodon routes at the ROOT so the
# federated remote is "browsable standalone"), so they run against `ng serve`
# with the harness pointed at it:
#
#     E2E_BASE_URL=http://localhost:4200  (with `npm start` / `ng serve mastodon`)
#     npx bddgen && npx playwright test        # default config already runs `not @cluster`
#
# They are DELIBERATELY UNTAGGED (the platform rule: offline-renderable UI stays
# untagged so the default no-cluster config runs it, while every backend-
# dependent scenario carries @cluster). Each asserts a REAL observable state
# transition — an aria-pressed flip and the DOM panel/section it gates, or a
# rendered empty state — so each FAILS against a blank page. The tab/filter
# controls set an Angular signal synchronously (ExploreComponent.selectTab,
# SearchComponent.selectType, NotificationsColumnComponent.selectFilter), so the
# pressed-state + panel swap do NOT depend on whether the component's init fetch
# resolved: the list-returning service methods fall back to [] on any non-OK/
# absent backend, so the view still renders and the client state still toggles.
#
# NOTE: because these navigate the dev-shell root routes (/explore, /search, …),
# a run against the HOST front door (the @cluster baseURL) would 404 them — the
# offline lane MUST set E2E_BASE_URL to the standalone `ng serve`. See e2e/README.
@mastodon-ui @offline @client-state
Feature: Client-side UI state — tabs, filters and empty states with no backend

  Scenario: the Explore trending tabs switch client-side with no backend
    Given a visitor opens the Explore standalone page
    Then the "posts" trending tab is pressed
    And the "posts" trending panel is shown
    When the visitor switches to the "tags" trending tab
    Then the "tags" trending tab is pressed
    And the "posts" trending tab is not pressed
    And the "tags" trending panel is shown
    When the visitor switches to the "links" trending tab
    Then the "links" trending tab is pressed
    And the "links" trending panel is shown

  Scenario: the Search type filter toggles client-side with no backend
    Given a visitor opens the Search standalone page
    Then the "all" search type is pressed
    When the visitor picks the "accounts" search type
    Then the "accounts" search type is pressed
    And the "all" search type is not pressed

  Scenario: the Notifications filter chips toggle client-side with no backend
    Given a visitor opens the Notifications standalone page
    Then the "All" notification filter is pressed
    When the visitor picks the "Mentions" notification filter
    Then the "Mentions" notification filter is pressed
    And the "All" notification filter is not pressed

  Scenario: the Lists index renders its empty state with no backend
    Given a visitor opens the Lists standalone page
    Then the lists index shows its no-lists empty state
