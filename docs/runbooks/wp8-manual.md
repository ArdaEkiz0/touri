# WP8 manual checklist

These checks require a real signed/dev desktop environment or the real legacy app host. Automated
tests use only local fixtures and fake transports.

- [ ] Run the SSH dry run exactly as documented, using a test account and a non-production app-data
      directory:
      `bun sidecar/src/importer/legacy/cli.ts --source ssh --host user@host.example --root ~/.legacy-app --dry-run`.
      Confirm the report contains one section per bot and counts for chats/threads, messages,
      routines, attachments, and dropped digest/options messages.
- [ ] Confirm the SSH dry run creates no file, temporary database, or changed transaction on the
      remote host. Inspect the remote legacy app directory and `/tmp` before and after the run.
- [ ] Run a local-source dry run with `--path` and verify the application database and bot homes do
      not change.
- [ ] With an approved path map, import mark, onb, and Panko from the remote host and compare the final
      bot/thread/message/routine counts with the source report. Verify the chat branch selector and
      active leaves in the UI.
- [ ] Re-import after adding messages on the remote host and verify only new messages are reported as
      created. Edit a local SOUL and enable an imported routine first; verify the SOUL edit and
      enabled state survive.
- [ ] If `--import-codex-sessions` is selected, acknowledge the raw-tool-output warning and verify
      the first mark turn resumes the copied rollout. Keep the default (off) path as the normal
      onboarding choice.
- [ ] Review the generated app-data tree and confirm no `config.json`, `sessions.json`,
      `hook-tokens`, auth/token/credential file, or unrelated workspace dot-mirror was copied.
- [ ] Exercise a failed import (for example, temporarily remove an allowlisted source file), verify
      the error report is redacted and staging is retained for investigation, then remove the
      staging directory after the retention window.
