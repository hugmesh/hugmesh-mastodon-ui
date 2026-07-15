# Voice & video MESSAGES in chats — recording in the compose box (mic/camera →
# MediaRecorder → File → the SAME uploadMedia attachment path a picked file
# uses) and playback on the receiving side (toot-card already renders <audio>/
# <video> attachments). The DM reply flow gets this for free because the
# conversations column embeds the same snap-mastodon-compose-box.
#
# HONESTY CONTRACT:
#   - capture is REAL: the recording steps launch the sender's browser context
#     with Chromium's fake capture device flags
#     (--use-fake-device-for-media-stream --use-fake-ui-for-media-stream), so a
#     genuine getUserMedia stream is recorded by a genuine MediaRecorder — the
#     steps never inject a pre-made file through the picker and call it a
#     "recording".
#   - the attachment is believed only after the POST /api/v2/media envelope is
#     captured off the wire (a real media id, an audio/video MIME) — never
#     because a preview element appeared.
#   - delivery is asserted CROSS-USER: the voice/video reply is recorded by the
#     RECIPIENT of a conversation started by a DIFFERENT persona, and playback
#     (<audio>/<video> in the toot-card) is observed from the ORIGINAL SENDER'S
#     session — a pass can never be explained by the recorder seeing their own
#     local preview.
#   - the DENY paths are exercised for real: Cancel/Discard scenarios assert no
#     media upload request was ever issued, and the permission-denied scenario
#     launches a context that BLOCKS the permission (no fake-UI auto-grant) and
#     asserts the fail-soft status — the composer must stay usable.
#
# @cluster — ships dark; the default config filters `not @cluster` so no live
# stack is needed. bddgen still compiles + lists every scenario. Un-tag once the
# env-test-build live wiring lands (same lifecycle as every other @cluster
# feature here).
@cluster @mastodon-ui @cross-user @social
Feature: Voice & video messages in chats — record, attach, deliver, play back

  Scenario: a recorded voice message reaches the other side of a direct conversation and plays back
    Given "user-a" has a seeded session in their own context with fake media capture granted
    And "user-c" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon"
    And "user-c" posts a direct status to "user-a" tagged "vm-thread"
    Then the "vm-thread" status appears in the conversations of "user-a" within 90 seconds
    When "user-a" opens the reply composer on the "vm-thread" conversation
    And "user-a" records a voice message for 3 seconds and stops
    Then the composer shows a voice take preview with attach and discard controls
    When "user-a" attaches the recorded take
    Then a real audio media upload is captured with a "voice-message-" filename
    When "user-a" sends the reply tagged "vm-voice-reply"
    Then the "vm-voice-reply" status appears in the conversations of "user-c" within 90 seconds
    And the "vm-voice-reply" status renders an audio player for "user-c"

  Scenario: a recorded video message shows a live self-view while recording and delivers as playable video
    Given "user-a" has a seeded session in their own context with fake media capture granted
    And "user-c" has a seeded session in their own context
    When "user-c" navigates to "/social/mastodon"
    And "user-c" posts a direct status to "user-a" tagged "vm-video-thread"
    Then the "vm-video-thread" status appears in the conversations of "user-a" within 90 seconds
    When "user-a" opens the reply composer on the "vm-video-thread" conversation
    And "user-a" starts recording a video message
    Then the composer shows a muted live camera preview and a running mm:ss clock
    When "user-a" stops the recording after 3 seconds and attaches the recorded take
    Then a real video media upload is captured with a "video-message-" filename
    When "user-a" sends the reply tagged "vm-video-reply"
    Then the "vm-video-reply" status appears in the conversations of "user-c" within 90 seconds
    And the "vm-video-reply" status renders a video player for "user-c"

  Scenario: cancelling a recording and discarding a take never upload anything
    Given "user-a" has a seeded session in their own context with fake media capture granted
    When "user-a" navigates to "/social/mastodon"
    And "user-a" starts recording a voice message
    And "user-a" cancels the recording
    Then no media upload request was issued
    When "user-a" records a voice message for 2 seconds and stops
    And "user-a" discards the recorded take
    Then no media upload request was issued
    And the composer shows no pending attachments

  Scenario: microphone permission denied is surfaced fail-soft and the composer stays usable
    Given "user-a" has a seeded session in their own context with microphone access blocked
    When "user-a" navigates to "/social/mastodon"
    And "user-a" starts recording a voice message
    Then the composer shows a recorder status explaining access was denied
    And no media upload request was issued
    And "user-a" can still submit a plain text status tagged "vm-denied-text"
