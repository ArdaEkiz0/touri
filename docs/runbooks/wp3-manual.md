# WP3 manual checklist

- [ ] With `TOURI_E2E_REAL_CLI=1`, use a disposable test bot and confirm Codex replies to `reply with the word pong`, then remembers a prior turn after resume.
- [ ] With `TOURI_E2E_REAL_CLI=1`, repeat the same smoke with Claude Code; verify the native `session_id` resumes on the second turn.
- [ ] Confirm the signed macOS build can interrupt a real long-running turn and that the UI shows the canceled partial reply.
- [ ] Confirm a real Claude permission prompt is shown as an approval card and that approve/deny reaches the CLI.

The automated WP3 suite never uses real CLI logins, network access, Chrome profiles, or Keychain entries.

