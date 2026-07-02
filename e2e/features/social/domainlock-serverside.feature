# SERVER-SIDE domain-lock coverage — beyond the composer's aria-disabled UI
# (domainlock-composer.feature), these prove the homeserver/MRF actually
# enforces the lock and that the honest 202 pending-reconcile envelope governs
# lock/unlock writes.
#
# Three claims, each proven behaviourally with a positive control:
#   1. LOCAL-ONLY: a locked user's private post delivers on the local server
#      (their local follower sees it) but NEVER reaches "user-b" — an ACCEPTED
#      CROSS-DOMAIN FOLLOWER, to whom a private post WOULD federate absent the
#      force-local MRF — nor the anonymous public timeline. The remote-follower
#      seed is what gives the absence probe its proving power over the MRF:
#      plain private-visibility semantics alone (a non-follower observer)
#      would guarantee the same absences with the MRF removed. A later-posted
#      public pacer status must federate first, so the negative also cannot
#      pass off a slow/dead federation pipe.
#   2. FAIL-CLOSED BYPASS: firing visibility=public straight at the compose API
#      with the locked session's token (skipping the disabled UI) is either
#      REJECTED (4xx) or COERCED to a non-federated visibility — a 2xx public
#      status is the vulnerability and fails the step. Either way the anonymous
#      public timeline never carries the marker.
#   3. UNLOCK FLIPS EVERYTHING: after a mod removes ROLE_MASTODON_DOMAINLOCKED
#      (202 pending-reconcile — never a synchronous "done"), a FRESH login is
#      polled until the marker really cleared, the composer's federated options
#      re-enable, and a public post is observed cross-domain. The lock is then
#      REAPPLIED so the locked-user persona stays locked for every other
#      feature and for reruns.
#
# @cluster — needs the live login remote (fresh-token polling), mod-bff, and a
# federating homeserver pair; ships dark, still compiles offline.
@cluster @mastodon-ui @user-situational @federation
Feature: Domain-lock enforced server-side — local-only delivery, fail-closed bypass, honest unlock
  As the homeserver enforcing the force-local MRF
  I must keep a domain-locked user's posts on this server no matter what the client sends
  So the composer's disabled controls are honest signalling, not the only line of defence

  Scenario: a locked user's post delivers locally but never crosses the domain
    # The locked composer only reaches "private", so the MRF probe rides the
    # follower graph: "user-b" (domain-B) is seeded as an ACCEPTED remote
    # follower — private posts federate to accepted remote followers, so
    # absent the force-local MRF this post WOULD land in user-b's home
    # timeline; its absence there is the MRF observed. (Follow/Accept are not
    # Note deliveries, so the force-local MRF does not block establishing the
    # relationship — the seed step polls the real relationship until
    # following:true and fails honestly if the Accept never lands.)
    # "user-c" is the local-follower positive control proving delivery, and
    # "user-a"'s later-posted public "dl-pace" status is the FEDERATION PACER:
    # it must arrive cross-domain BEFORE the absence checks run, so the
    # negative cannot pass merely because the domain-A→B pipe was slow or down
    # — anything the MRF let out would have beaten the pacer.
    Given "locked-user" has a seeded session in their own context
    And "user-a" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    And "user-c" follows "locked-user" on mastodon
    And "user-b" follows "locked-user" on mastodon
    When "locked-user" navigates to "/social/mastodon"
    And "locked-user" posts a "private" status tagged "dl-local"
    Then the "dl-local" status appears in the home timeline of "user-c" within 30 seconds
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a "public" status tagged "dl-pace"
    Then the "dl-pace" status appears in the federated timeline of "user-b" within 90 seconds
    And the "dl-local" status never appears in the home timeline of "user-b"
    And the "dl-local" status never appears in the federated timeline of "user-b"
    And the signed-out public timeline never shows the "dl-local" status

  Scenario: a forced-federated payload is rejected or coerced server-side (fail-closed beyond aria-disabled)
    Given "locked-user" has a seeded session in their own context
    When "locked-user" fires a raw public post tagged "dl-forced" through the compose API
    Then the raw post is rejected or coerced to a non-federated visibility
    And the signed-out public timeline never shows the "dl-forced" status

  Scenario: removing the domain lock re-enables federation end-to-end (then the lock is restored)
    Given "mod-a" has a seeded session in their own context
    And "locked-user" has a seeded session in their own context
    And "user-b" has a seeded session in their own context
    When "mod-a" removes the mastodon domain lock on "locked-user"
    Then the moderation response is the honest pending-reconcile envelope
    Given "locked-user" logs in freshly until the mastodon domain-lock marker clears within 120 seconds
    When "locked-user" navigates to "/social/mastodon"
    Then "locked-user" sees the federated visibility options enabled
    When "locked-user" posts a "public" status tagged "dl-unlocked"
    Then the "dl-unlocked" status appears in the federated timeline of "user-b" within 90 seconds
    When "mod-a" reapplies the mastodon domain lock on "locked-user"
    Then the moderation response is the honest pending-reconcile envelope
