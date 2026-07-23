# CROSS-USER coverage — the ADMIN ORG-DEFAULT appearance inheritance (audit gap:
# PreferencesService.setOrgDefault → PUT /bff/admin/mastodon/appearance-default
# and the non-customised-user adoption path (loadOrgBffDefault, GET
# /bff/mastodon/appearance-default) were entirely untested — chat-theme-sweep
# stubs the prefs API and never touches the admin control. This is a cross-user
# admin write that changes what every non-customised user in the brand sees).
#
# HONESTY CONTRACT:
#   - the admin write is a REAL click on admin-set-default and is believed only
#     off its PUT /bff/admin/mastodon/appearance-default response (200/202) plus
#     the announced live-region copy — never the click alone;
#   - adoption is proven from a DIFFERENT persona's OWN context: user-c reloads
#     the remote and the mastodon-view root carries data-mastodon-theme with the
#     admin's chosen value (loadOrgBffDefault only adopts for a caller who has
#     NOT customised — a fresh context is non-customised);
#   - the isolation leg proves the flip is gated on non-customisation: a user
#     who picked their OWN theme keeps it on reload despite the new org default;
#   - CLEANUP: the last steps restore the org default to the built-in
#     'hug-neon' so the durable, brand-wide side effect never leaks into other
#     features' baseline (the write is domain-persisted, unlike a per-user pref).
#
# @cluster — ships dark; the default config filters `not @cluster`. bddgen still
# compiles + lists every scenario.
@cluster @mastodon-ui @cross-user @social @appearance
Feature: Admin org-default appearance — a non-customised user inherits it, a customised user keeps their own

  Scenario: an admin sets an org default and a never-customised user adopts it on reload
    Given "admin-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "admin-a" navigates to "/social/mastodon"
    And "admin-a" opens the appearance panel
    And "admin-a" selects the "pastel-sky" theme in the appearance panel
    And "admin-a" sets the current appearance as the default for everyone
    Then "admin-a" sees the org-default-saved announcement
    When "user-c" navigates to "/social/mastodon"
    Then the remote root for "user-c" carries data-mastodon-theme "pastel-sky" within 30 seconds
    # ── restore the brand-wide default so nothing leaks into other features ──
    When "admin-a" selects the "hug-neon" theme in the appearance panel
    And "admin-a" sets the current appearance as the default for everyone

  Scenario: a user who customised their theme keeps it despite a new org default
    Given "admin-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon"
    And "user-c" opens the appearance panel
    And "user-c" selects the "mono" theme in the appearance panel
    Then the remote root for "user-c" carries data-mastodon-theme "mono" without reloading
    When "admin-a" navigates to "/social/mastodon"
    And "admin-a" opens the appearance panel
    And "admin-a" selects the "pastel-sky" theme in the appearance panel
    And "admin-a" sets the current appearance as the default for everyone
    Then "admin-a" sees the org-default-saved announcement
    When "user-c" navigates to "/social/mastodon"
    Then the remote root for "user-c" carries data-mastodon-theme "mono" within 30 seconds
    # ── restore: org default back to the built-in, and user-c's own prefs reset
    When "admin-a" selects the "hug-neon" theme in the appearance panel
    And "admin-a" sets the current appearance as the default for everyone
    And "user-c" opens the appearance panel
    And "user-c" resets their own appearance to default
