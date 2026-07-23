# CROSS-USER coverage — POLLS (audit gap: composer poll creation, PollComponent
# voting/results and voteOnPoll() had ZERO e2e anywhere). A poll is a genuinely
# multi-user interactive surface: a vote is once-only, the results view is
# revealed after voting, and the counts come from the server.
#
# HONESTY CONTRACT:
#   - the poll is created through the REAL composer (poll toggle + option
#     inputs) and believed only off the POST /api/v1/statuses response, which
#     must echo a poll with the requested options;
#   - the vote is believed only off the POST /api/v1/polls/{id}/votes response
#     (the updated Poll entity with voted:true) — never because bars appeared;
#   - the author's count observation polls their OWN view of the status
#     permalink until the server-side votes_count reflects the other user's
#     vote (bounded poll, never a sleep);
#   - voter and author are DIFFERENT personas in their own contexts, so a pass
#     can never be explained by self-voting.
#
# @cluster — ships dark; the default config filters `not @cluster`.
@cluster @mastodon-ui @cross-user @social
Feature: Polls — cross-user voting updates results for voter and author

  Scenario: another user votes on a single-choice poll and both sides see the result
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a poll status tagged "poll-src" with options "tea" and "coffee"
    Then the "poll-src" status appears in the federated timeline of "user-c" within 90 seconds
    When "user-c" selects poll option 1 on the "poll-src" status and votes
    Then "user-c" sees the poll results with their own vote marked on the "poll-src" status
    And the "poll-src" poll shows 1 vote to "user-a" within 90 seconds

  Scenario: a multiple-choice poll accepts two selections in one vote
    Given "user-a" has a seeded session in their own context
    And "user-c" has a seeded session in their own context
    When "user-a" navigates to "/social/mastodon"
    And "user-a" posts a multiple-choice poll status tagged "poll-multi" with options "red" and "blue" and "green"
    Then the "poll-multi" status appears in the federated timeline of "user-c" within 90 seconds
    When "user-c" selects poll options 1 and 3 on the "poll-multi" status and votes
    Then "user-c" sees the poll results with 2 own votes marked on the "poll-multi" status
    And the "poll-multi" poll shows 2 votes to "user-a" within 90 seconds
