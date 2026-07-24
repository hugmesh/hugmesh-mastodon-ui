# MULTI-USER coverage — the FULL USER→MOD→ADMIN moderation escalation chain
# (audit gap: each link only ever tested in isolation as control-renders or
# API-200s; no scenario drove recommend → queue row → refer → decide end to
# end, and AdminBffService.decide() was exercised nowhere).
#
# The chain, each hop in its OWN persona's context with a REAL click:
#   USER   user-a  recommends a block of a remote instance (reason attached) —
#                  POST /bff/user/recommend-instance-block via the actions menu;
#   MOD    mod-a   opens the moderation queue, sees the row status
#                  'recommended', refers it — POST /bff/mod/moderation/{id}/refer
#                  → 'referred' (a mod CANNOT decide — refer is the only path);
#   ADMIN  admin-a opens the queue, Approves — POST
#                  /bff/admin/moderation/{id}/decide?approve=true → 'approved',
#                  announced in the live region;
#   MOD    mod-a   reloads the queue in their own context and sees 'approved' —
#                  the decision is visible across roles, not just to its author.
#
# HONESTY NOTES:
#   - the recommendation targets the INSTANCE of a real cross-domain persona
#     (user-b): instance() is the domain half of the acct, so the step FAILS
#     LOUDLY unless the runner exports E2E_USER_B_ACCT=user-b@<host> (the same
#     precondition the cross-domain post-visibility legs already carry);
#   - the queue row is located by its TARGET INSTANCE (this run's real
#     recommendation), and each status transition is read from the row's
#     rendered status cell — the API envelope alone is never trusted;
#   - each transition is also announced in the acting persona's live region
#     (the component's ok() copy) and asserted verbatim.
#
# @cluster — ships dark; the default config filters `not @cluster`.
@cluster @mastodon-ui @cross-user @moderation
Feature: Escalation chain — a user's recommendation travels through mod referral to an admin decision

  Scenario: recommend, refer, approve — the row's status advances at every hop and lands for the mod
    Given "user-b" has a seeded session in their own context
    And "user-a" has a seeded session in their own context
    And "mod-a" has a seeded session in their own context
    And "admin-a" has a seeded session in their own context
    When "user-b" navigates to "/social/mastodon"
    And "user-b" posts a "public" status tagged "esc-src"
    Then the "esc-src" status appears in the federated timeline of "user-a" within 90 seconds
    When "user-a" opens the actions menu on the "esc-src" status
    And "user-a" fills the actions reason with a run-unique note
    And "user-a" recommends an instance block from the actions panel
    Then "user-a" sees the recommendation acknowledged for the instance of "user-b"
    When "mod-a" navigates to "/social/mastodon"
    And "mod-a" opens the actions menu on the first post
    And "mod-a" opens the moderation queue
    Then the moderation queue row for the instance of "user-b" reads status "recommended"
    When "mod-a" refers that queue row to an admin
    Then the moderation queue row for the instance of "user-b" reads status "referred"
    And "mod-a" sees the referral announced
    When "admin-a" navigates to "/social/mastodon"
    And "admin-a" opens the actions menu on the first post
    And "admin-a" opens the moderation queue
    Then the moderation queue row for the instance of "user-b" reads status "referred"
    When "admin-a" approves that queue row
    Then "admin-a" sees the approval announced
    And the moderation queue row for the instance of "user-b" reads status "approved"
    When "mod-a" opens the moderation queue
    Then the moderation queue row for the instance of "user-b" reads status "approved"
