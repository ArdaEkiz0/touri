# WP1 manual acceptance checklist

These checks require a built Tauri app and are intentionally kept outside automated Rust tests. They must use a disposable sidecar fixture and a test release; never use a real CLI login, the user's Chrome profile, or a production Keychain account.

## Desktop lifecycle

- [ ] Start an unsigned local build with the fixture sidecar and confirm the UI receives `sidecar_endpoint`.
- [ ] Kill the sidecar child process. Confirm a `sidecar-ready` event and a usable UI connection return within 5 seconds.
- [ ] Choose Quit from the tray. Confirm the sidecar receives `app.willQuit` and exits within 10 seconds.
- [ ] Close the main window. Confirm it hides and remains available from the tray.
- [ ] Launch a second app instance. Confirm the first instance is focused and no second sidecar is started.
- [ ] Enable and disable Launch at Login from the Settings UI; confirm the LaunchAgent follows the setting.
- [ ] Put the Mac to sleep and wake it; confirm the authenticated sidecar receives `power.sleep` with `sleeping: true` and then `sleeping: false`.

## Preview webview

- [ ] Show `http://localhost:5173/x` and confirm it renders in the child Preview webview.
- [ ] Navigate the Preview webview to `https://example.com` and `file:///tmp/index.html`; confirm navigation is canceled and the URL is opened externally.
- [ ] Log in to a disposable local admin, restart the app, and confirm the Preview webview's separate data store preserves its session.
- [ ] Resize the Preview slot and confirm `preview_set_bounds` keeps the child webview aligned.

## Release and updater (disabled by default)

- [ ] On a fork with an Apple Developer team, set `TOURI_ENABLE_SIGNING=true` and the documented Apple secrets, tag a release, and confirm the arm64 DMG is signed.
- [ ] Set `TOURI_ENABLE_NOTARIZATION=true`; confirm `xcrun stapler staple` succeeds and `spctl -a -vv` accepts the app.
- [ ] Configure the updater public key, endpoint, and `TOURI_ENABLE_UPDATER=true`; publish a newer test release and confirm `updater_check` reports it, then install and relaunch.
- [ ] Leave all three switches false for unsigned local builds and confirm update install is refused without contacting a release endpoint.

## WP7 replacement handoff

- [ ] When WP7 lands, add `src-tauri/src/computer/mod.rs`, remove the `#[path = "computer_stub.rs"]` module switch in `src-tauri/src/lib.rs`, and keep the same `dispatch`, `kill`, and `status` signatures.
- [ ] Re-run the computer permission and kill-switch checks after the replacement; the tray Stop item already calls the stable `computer::kill()` seam.
