# WP5 manual checklist

Use a signed development build on a Mac with Homebrew `mongod` and `redis-server` available. Do not use Docker, real CLI logins, a personal Chrome profile, or real Keychain entries; use a disposable test service name for any manual secret setup.

## MyApp smoke (SPEC 4.5)

- [ ] Connect `~/javascript/MyApp` as a local project and confirm the resolved real path, git branch, and clean/dirty state.
- [ ] Add the disposable admin/server secret names from `.env.example`; verify the UI shows names only.
- [ ] Create a Codex bot named `dev` with `workspace-write` access and approvals enabled, attached to the project.
- [ ] Ask the bot to configure the repository and start the admin.
- [ ] Confirm it uses `pnpm install`, `env_write_file`, and supervised definitions for MongoDB, Redis, the server, and the admin.
- [ ] Confirm the process panel shows all four processes as `ready`, with dependencies started in order.
- [ ] Confirm the Preview pane shows the local admin login page and that `preview_open` selects it.
- [ ] Quit and relaunch touri; confirm autostart restores the processes and preview, while `node_modules` and ignored `.env` files remain intact.
- [ ] Send `oi`; confirm the same Codex session remembers the prior exchange and its `provider_sessions` row is unchanged.
- [ ] During a turn, kill the fake/controlled Codex child; confirm the run is `failed (cli_crash)`, partial output remains, and the next message carries the redacted carryover note.

