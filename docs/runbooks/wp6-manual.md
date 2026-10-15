# WP6 manual checklist

The automated suite uses headless Chrome and a temporary profile. These checks require a deliberate headed run and must only be performed with `TOURI_E2E_HEADED=1` in a disposable touri test profile.

- [ ] Confirm the configured system Chrome or pinned Chrome for Testing binary launches with the expected persistent profile and no user profile is opened.
- [ ] Use the browser panel to take over a tab, complete a user-only step, hand the tab back, and confirm the agent receives a fresh snapshot with invalidated refs.
- [ ] Confirm a sign-in cookie survives a sidecar restart without copying or inspecting credential values.
- [ ] Confirm an alert is accepted automatically while confirm, prompt, and beforeunload dialogs remain visible in snapshot notes.
- [ ] Confirm the configured window position and size are applied only in a headed run; headless runs must not call a visible-window placement path.
