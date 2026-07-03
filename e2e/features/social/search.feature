# CROSS-USER coverage — Search (search.component.ts, /api/v2/search), scoped
# to what is RELIABLY indexed on every Mastodon/Akkoma deployment:
#   - an exact account handle (webfinger-style lookup — no search backend
#     dependency).
#   - a hashtag used in a real post (the Tag table — also backend-independent).
#
# DISCLOSED GAP: free-text STATUS-content search is NOT covered. Mastodon only
# full-text-indexes statuses for search when an optional ElasticSearch backend
# is configured (Akkoma's is DB-native, but this wave targets both), and
# nothing in this repo lets an e2e prove which backend a given deployment runs
# — asserting content search would risk an environment-dependent false claim on
# a stack without it. A future wave with a known search backend can add it.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is
# needed. bddgen still compiles + lists every scenario.
@cluster @mastodon-ui @cross-user @social
Feature: Search — cross-user discovery of accounts and hashtags

  Scenario: an account is discoverable by another user via its exact handle
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon/search"
    And "user-c" searches for the mastodon handle of "user-a"
    Then "user-c" sees "user-a" in the People search results within 30 seconds

  Scenario: a hashtag used in a real post is discoverable by another user
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "search-tag" with the hashtag "search-tag"
    Then the "search-tag" status appears in the federated timeline of "user-c" within 90 seconds
    When "user-c" navigates to "/social/mastodon/search"
    And "user-c" searches for the "search-tag" hashtag
    Then "user-c" sees the "search-tag" hashtag in the Hashtags search results within 30 seconds

  Scenario: the type filter scopes results to just the requested section
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon/search"
    And "user-a" searches for the mastodon handle of "user-c"
    And "user-a" selects the "accounts" search type
    Then "user-a" sees only the "accounts" search section
