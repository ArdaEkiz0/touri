# WP7 computer-use QA checklist

These checks require a signed dev build on a disposable macOS account or test
machine. Use the fixture sidecar, a disposable bot, and a non-production app
bundle. Do not use a real CLI login, the user's Chrome profile, production
Keychain accounts, or real secrets.

## Prepare

- [ ] Build and sign the dev app with the WP7 sidecar fixture.
- [ ] Confirm the test bot has `computer_use` enabled and no active grant.
- [ ] If retesting TCC behavior, reset only the dev app's entries:
      `tccutil reset Accessibility ai.touri.desktop` and
      `tccutil reset ScreenCapture ai.touri.desktop`.
- [ ] Use a Retina display and record the display scale shown by the native
      screenshot result.

## Permission onboarding

- [ ] Open Settings → Computer use and confirm Accessibility and Screen
      Recording are shown as separate statuses.
- [ ] Click Grant for Accessibility. Confirm macOS prompts once, the matching
      System Settings pane opens, and polling reflects the resulting status.
- [ ] Click Grant again after the permission is granted. Confirm no second
      prompt is shown.
- [ ] Repeat for Screen Recording. If macOS reports that relaunch is needed,
      confirm the UI shows a Relaunch touri action.
- [ ] Revoke one permission, enable computer use for the bot, and invoke a
      computer tool. Confirm it returns `PERMISSION_MISSING` and does not open
      a permission prompt from the tool call.

## Capture, mapping, and input

- [ ] Grant the bot for one turn and confirm the approval card is time-boxed.
- [ ] Capture a screenshot while the HUD is visible. Confirm the returned
      image does not contain the HUD or the approval card.
- [ ] Use the screenshot coordinates to click a disposable on-screen target.
      On the Retina display, confirm the click lands on the expected global
      pixel after scale conversion.
- [ ] Type `ação ✓` into a disposable text field and confirm accents and the
      check mark arrive correctly.
- [ ] Exercise a key combo such as `cmd+shift+4` only in a safe test context;
      do not save or share the resulting capture.
- [ ] Verify click, move, scroll, and the 300 ms post-action screenshot all
      complete without exposing secret values.

## Kill switch and cleanup

- [ ] Start computer use and press `⌃⌥⌘.`. Measure from key press to input
      rejection; it must be under 200 ms. Confirm the HUD disappears, the
      tray returns to its idle state, and the active grant is revoked as
      `kill-switch`.
- [ ] Repeat with the tray item “Stop computer use” and `POST /computer/kill`.
- [ ] Confirm a tool already in flight fails with `COMPUTER_KILLED`, and that
      a new grant is required before computer use can resume.
- [ ] Confirm an expired grant cannot perform input and is recorded as
      `revoked_by = 'expiry'`.
- [ ] Quit the test app and remove any fixture data, screenshots, or temporary
      permission state created during this checklist.
