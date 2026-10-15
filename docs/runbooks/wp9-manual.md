# WP9 manual verification checklist

Automated coverage lives in `ui/test/app.test.tsx` and `ui/test/e2e/main.spec.ts`. These checks require the native Tauri shell or a human visual pass.

- [ ] Launch the Tauri app with the mock/fixture sidecar and confirm the touri wordmark, red `#dc2626` accent, DM Sans / DM Mono / Space Grotesk fonts, and light/dark theme switching.
- [ ] Open Doctor and verify Codex, Claude, shell environment, Git, and Node states are readable; toggle “Launch touri at login” and confirm the setting is persisted by the native shell.
- [ ] Open a project and enter a test value through the Secrets form. Confirm the native `secret_save` command is used, the sidecar request contains only metadata, and the value does not appear in UI logs, chat, or network inspection.
- [ ] Start a process with a localhost HTTP port. Confirm the native child webview is positioned over the Preview slot, reload/back/open-external controls work, and only localhost URLs are allowed.
- [ ] Open any modal while Preview is visible. Confirm the native preview hides before the modal can cover it, then returns and receives updated bounds after the modal closes and the window resizes.
- [ ] In Browser, confirm tabs are from the touri-owned Chrome profile, “Show agent browser” focuses the headed browser, and Take over / Hand back changes the held state.
- [ ] Trigger a browser secret request with a test service. Confirm the toast appears and no secret value is rendered in the Browser panel or chat.
- [ ] With a real sidecar fixture (never a personal CLI login), send a message, stop a run, retry a failed run, paste/drop an image, and verify the persisted message tree and branch controls.
- [ ] Run the import wizard against a copied local legacy app fixture, review the dry-run report, complete import, and verify the cut-over checklist states that imported routines are disabled.
