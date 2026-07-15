# OFFLINE / CLIENT-SIDE coverage — the VOICE/VIDEO MESSAGE RECORDER driven with
# a scripted FAKE MediaRecorder + getUserMedia injected via addInitScript (see
# recorder-offline-steps.ts). The @cluster voice-video-messages.feature proves
# REAL capture + cross-user delivery on a live stack; THIS feature keeps the
# composer's recording STATE MACHINE (start → live status/clock → stop → take
# preview → attach/discard/cancel) runnable headless: the fake recorder is
# deterministic (no real devices, no permission UI), the media upload endpoint
# is page.route-stubbed, and every DENY path asserts that no upload request was
# ever issued.
#
# The 64 MiB attach guard is exercised for real: the fake recorder is told to
# emit an oversized blob and the polite aria-live refusal must appear with
# nothing leaving the browser.
@mastodon-ui @offline @recorder
Feature: Voice & video recorder offline — mocked capture, state machine, size guard

  Background:
    Given the media upload API is stubbed
    And fake media capture is installed
    And a visitor opens the Home standalone page

  Scenario: recording a voice message — pressed state, live clock, stop, preview, attach
    When the visitor starts a voice recording
    Then the voice record button reads pressed
    And the recorder status announces a running voice recording with a clock
    When the visitor stops the recording with the keyboard
    Then a voice take preview offers attach and discard
    When the visitor attaches the take
    Then a media upload request carries a "voice-message-" filename
    And a pending attachment row appears in the composer

  Scenario: recording a video message shows the muted live self-view
    When the visitor starts a video recording
    Then the video record button reads pressed
    And a muted live camera preview is shown
    And the live camera preview fits the viewport
    When the visitor stops the recording with the keyboard
    Then a video take preview offers attach and discard

  Scenario: cancel during recording and discard of a take never upload anything
    When the visitor starts a voice recording
    And the visitor cancels the recording with the keyboard
    Then no media upload request was issued offline
    When the visitor starts a voice recording
    And the visitor stops the recording with the keyboard
    And the visitor discards the take
    Then no media upload request was issued offline
    And the composer shows no pending attachment rows

  Scenario: a take over 64 MiB is refused with a polite announced error and no upload
    Given the fake recorder will produce an oversized take
    When the visitor starts a voice recording
    And the visitor stops the recording with the keyboard
    And the visitor attaches the take
    Then the oversized-take refusal is announced politely
    And no media upload request was issued offline
    And the take preview is still available to discard

  Scenario: permission denied surfaces fail-soft and the composer stays usable
    Given fake media capture is installed but permission is denied
    When the visitor starts a voice recording
    Then the recorder explains that access was denied
    And no media upload request was issued offline
    And the compose textarea still accepts input

  Scenario: the recorder panel fits a phone viewport
    Given the viewport is a phone
    When the visitor starts a video recording
    Then there is no horizontal page scroll
    And the live camera preview fits the viewport
