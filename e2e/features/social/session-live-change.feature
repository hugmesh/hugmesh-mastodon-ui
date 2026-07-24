# OFFLINE / CLIENT-SIDE coverage — MID-SESSION ROLE / DOMAIN-LOCK CHANGES via
# the session broadcast (audit gap: SessionService re-reads on
# storage/broadcast events and ComposeBoxComponent's ngDoCheck explicitly
# claims "a lock that arrives via the session broadcast is honoured even on an
# already-open composer" — yet no test covered a role or lock landing
# mid-session).
#
# Fully offline: the dev-shell routes carry no guard and both surfaces under
# test are PURE CLIENT-SIDE gating (the composer's domain-lock coercion and
# the role-tier rendering of the actions menu), which is exactly the carve-out
# the seeded client-side session step exists for. The "change" is the REAL
# mechanism production uses: a new hug.session written to localStorage plus
# the same-document 'hug-session-change' broadcast SessionService subscribes
# to — never a reload.
@mastodon-ui @offline @session
Feature: Mid-session role and domain-lock changes land live via the session broadcast

  Scenario: a domain lock arriving mid-session coerces an already-open composer without a reload
    Given "user-a" has a seeded client-side session
    And a visitor opens the Home standalone page
    When "user-a" selects the "public" compose visibility
    Then "user-a" sees the federated visibility options enabled
    When the session roles become "mastodon,mastodon_domainlocked" via the live broadcast
    Then the composer visibility select reads "private" without a reload
    And "user-a" sees the federated visibility options disabled
    And "user-a" sees the local-only toggle enforced

  Scenario: losing the mod role mid-session removes the MOD tier from an open actions menu
    Given the home timeline API is stubbed with one post
    And "mod-a" has a seeded client-side session
    And a visitor opens the Home standalone page
    When "mod-a" opens the actions menu on the first post
    Then "mod-a" sees the "tier-mod" tier
    When the session roles become "mastodon" via the live broadcast
    Then "mod-a" does not see the "tier-mod" tier

  Scenario: gaining the admin role mid-session reveals the ADMIN tier without a reload
    Given the home timeline API is stubbed with one post
    And "mod-a" has a seeded client-side session
    And a visitor opens the Home standalone page
    When "mod-a" opens the actions menu on the first post
    Then "mod-a" sees the "tier-mod" tier
    And "mod-a" does not see the "tier-admin" tier
    When the session roles become "mastodon,mod,admin" via the live broadcast
    Then "mod-a" sees the "tier-admin" tier
