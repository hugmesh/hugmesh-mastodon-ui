# OFFLINE / CLIENT-SIDE coverage — the CREATE-LIST control on the lists index
# (lists-index.component.*: a titled input + "Create list" button that POSTs
# { title } to /api/v1/lists via MastodonService.createList, then adds the
# server-confirmed row). This closes the create-list PRODUCT gap the wave-3
# lists coverage recorded ("only RENDERS existing lists; no create-list UI").
#
# Like client-state.feature, these run OFFLINE against the remote's dev-shell
# (app.routes.ts mounts the exposed routes at the ROOT), so they drive the
# standalone /lists route with the harness pointed at `ng serve`:
#
#     E2E_BASE_URL=http://localhost:4202   (with `npm start` / `ng serve mastodon`)
#     npx bddgen && npx playwright test        # default config already runs `not @cluster`
#
# They are DELIBERATELY UNTAGGED w.r.t. @cluster (the platform rule: offline-
# renderable UI stays untagged so the default no-cluster config runs it). The
# validation scenario needs NO backend at all (the empty-title guard is a pure
# signal read). The add / reject scenarios STUB the create response with
# page.route so the submit → POST → append (or → error) wiring is proven with no
# live homeserver — the same-origin /bff/user/mastodon/api/v1/lists path the
# dev-shell service targets by default. Each asserts a REAL observable
# transition (a disabled→enabled flip, a new row, a cleared input, an announced
# error), so each FAILS against a blank page.
#
# NOTE: because these navigate the dev-shell root route (/lists), a run against
# the HOST front door (the @cluster baseURL) would 404 it — the offline lane
# MUST set E2E_BASE_URL to the standalone `ng serve`. See e2e/README.
@mastodon-ui @offline @lists-create
Feature: Create-list control — validation and optimistic add with no backend

  Scenario: the create-list submit is gated on a non-blank title
    Given a visitor opens the Lists standalone page
    Then the create-list submit is disabled
    When the visitor types "Close friends" into the new-list title
    Then the create-list submit is enabled
    When the visitor clears the new-list title
    Then the create-list submit is disabled

  Scenario: creating a list adds the new row to the index and clears the input
    Given the create-list API will accept new lists
    And a visitor opens the Lists standalone page
    When the visitor types "Reading" into the new-list title
    And the visitor submits the new-list form
    Then the "Reading" list appears in the lists index
    And the new-list title is cleared

  Scenario: a rejected create is announced and leaves the index unchanged
    Given the create-list API will reject new lists
    And a visitor opens the Lists standalone page
    When the visitor types "Doomed" into the new-list title
    And the visitor submits the new-list form
    Then the create-list error is shown
    And the "Doomed" list is not in the lists index
