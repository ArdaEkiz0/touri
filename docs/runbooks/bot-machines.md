# Bot machines

`local` remains the default for new and migrated bots. `vm` uses Apple `container`
on macOS 26+ / Apple Silicon. Linux and `touri serve` expose the option as disabled
with **sem virtualização neste host**. There is no native-process fallback for a VM bot.

The bot settings and create dialog expose the machine, idle minutes (10 by default),
provider-login opt-in and a separate host-computer-use opt-in. Machine status and
first-image progress appear in settings and the conversation. `/machines` reports
capability and states; `machine.updated` streams changes to the UI.

When the Apple container service is down, the chat, machine header and Doctor report
`TOURI-E8001`: **O serviço de máquinas do macOS não está ativo.** Their **Iniciar serviço**
button calls `POST /machines/service/start`; the sidecar checks `container system status`,
runs `container system start` only when needed and verifies the service. From a bot's
conversation it then retries that machine's normal preparation, preserving its workspace
and failed turn. Use Retry to rerun the turn after preparation. Concurrent service starts
are coalesced; failures show `TOURI-E8002`. Doctor refreshes its checks after the action.

A failed turn can coexist with preparation for the viewer or next turn. The header
explains that independent preparation and offers **Parar máquina**, which cancels that
bot's turns and prewarming, closes only its viewer connections and stops its machine.
VM timeout replies suggest **Tentar de novo quando a máquina estiver pronta.**

## Runtime and storage

The first turn or composer focus lazily builds or reuses `touri-bot:6`, creates a named volume and starts
the guest. Each bot has 2 CPUs, a 1536 MiB default memory limit and one sparse 20 GiB workspace
volume. IDs include an app-data hash, so different installations/worktrees do not
share machines. `/workspace` is the working directory; `.home` holds provider state,
MEMORY, skills and the browser profile; `.touri` holds guest run and service state.

Preferences → General exposes `botVmMemoryMb` (512–16384 MiB). The cap applies at
creation or image recreation; existing guests keep their configured cap until then.
The guest Chromium launch limits renderers to 2, disables BackForwardCache and caps
each JavaScript heap at 512 MiB. Existing per-bot idle preferences are preserved.

The image installs Node 22, pnpm 10, git, Python 3, curl, Chromium, Xvfb, xdotool,
ImageMagick, socat, Codex 0.162.1 and Claude Code 2.1.296. Its source is
`sidecar/src/vm/image/Containerfile`, embedded into compiled sidecars as a build
context. The image is built once and cached. A cold build requires 12 GiB free disk;
the Doctor checks 5 GiB when the image is already present. The builder is stopped
after app builds and image upgrades, including failure and cancellation. It can retain substantial build cache: remove that cache before another
build on a disk with little free space. Image builds use no forwarded secrets or SSH agent.

A connected project is seeded once from `git archive HEAD`, then initialized as a
guest Git repository. Uncommitted/untracked files, ignored `.env` files, the host
`.git`, SSH agent, sockets and host home are not copied or mounted. Work done in the
VM stays there; it does not modify the host checkout. The project must have a commit.
Changing an already seeded project requires **Recriar do zero** with the new project
selected; this is confirmed before deleting data. Switching providers or returning
to local mode stops the machine and preserves its volume.

Idle polling does not count as bot activity. Active turns hold a lease; browser and
computer operations touch activity. The 30-second sweep stops a guest after its
idle window even when a development server remains running. Next use starts the
same VM/volume. Open viewer/control sockets and live viewer heartbeats also hold
leases. A guest stopped for inactivity displays **Em repouso**. VM autostart processes resume only with a running machine. Restart
keeps the volume; reset deletes the container, volume and provider sessions; deleting
a bot destroys its machine before archiving the bot. Restart/reset/delete reject busy
machines until their turns are stopped. Application quit stops guests and revokes staging files.

At startup and hourly, the sidecar stops and force deletes only `touri-migrate-*`
and `touri-upgrade-test-*` helpers. Cleanup is serialized against migrations; it
never sweeps bot containers. Their `*-data` volumes are deleted only when no surviving
container or persisted bot metadata references them. A successful rootfs migration
retains its data volume as the bot workspace. Stop has a timeout; force deletion
retries once. Failures log `VM_HELPER_CLEANUP_FAILED`, `VM_HELPER_VOLUME_CLEANUP_FAILED`,
`VM_ORPHAN_SWEEP_FAILED` or `VM_BUILDER_STOP_FAILED` for later diagnosis.

Composer focus and typing send `/bots/:id/machine/intent` to warm a VM before a turn;
typing is throttled to one request per five seconds. Paused and local bots do not
prewarm. Workspace inactivity uses each bot's idle minutes, measured since the last
turn, exec, composer activity or viewer release. Window blur, app background, Preview
tab changes and desktop session close do not request an immediate or deferred stop.
Active turns and viewers hold leases; their release starts a fresh idle window.
The host rechecks activity before every idle stop, including queued requests.
Explicit machine stop, reset, deletion and application quit still stop guests. Parking preserves
the workspace, image upgrade checks and provider sessions.

Provider `create` and `start` return a typed connection descriptor: machine identity,
host endpoints, port mappings, display geometry, bridge paths and a derived authentication
key ID. `/machines` and `machine.updated` expose the current descriptor, or null when
the connection is unavailable. Dynamic forwarding refreshes it. UI consumers use those
endpoints; they do not construct guest URLs.

Provider adapters keep the existing JSON streaming, approvals, session resume and
cancellation protocol. Their VM execution path never merges the host environment.
`container exec --interactive` carries stdin/stdout; `setsid --wait` keeps the guest
session attached. Cancel/stop kills the guest process group as well as the host CLI child.

Each VM turn preparation writes a private `${threadId}.${nonce}.token` file and passes
its exact path to the guest MCP shim. Native resumes override the persisted MCP config
with the new path, while the session fingerprint remains stable. The shim retries a
missing/empty file for at most two seconds and reports startup errors on stderr.
Host authentication requires a live per-run credential, revalidates each request and
closes its connections on release. Release revokes host authorization before deleting
only its own guest file; a late cleanup cannot remove the following turn's token.
Credentials left on disk after a crash are not accepted by the new host runtime.
CLI MCP startup failures fail the turn with “As ferramentas do touri não carregaram
nesta máquina” and appear in Doctor until a subsequent successful turn.

## Credentials

No host login is read unless the bot has **Usar meu login do Codex/Claude dentro da VM**
enabled. Only `~/.codex/auth.json` or `~/.claude/.credentials.json` is copied into the
bot's dedicated staging directory, mounted read-only at `/run/touri-auth`. The guest
auth path links to that file during the turn. Staging is revoked after the last lease,
when the opt-in is removed, on shutdown and at sidecar startup after an interrupted run.
SQLite stores only the preference, never credential content. Known secret values are
registered with the redactor; the turn stream retains possible credential prefixes
between deltas so splitting a token across frames does not defeat redaction.

The bridge connection is stored at `/workspace/.touri/run/connection.sealed.json` with
mode 0600. The original versioned envelope uses AES-256-GCM with a random 12-byte nonce
and 16-byte tag; its authenticated header binds it to the machine and key ID. The
32-byte key is stored through the authenticated host bridge in macOS Keychain under
`vm-connection/<machine-id>`. There is no plaintext key fallback. Only its SHA-256 ID
reaches machine state/events; the bridge token and endpoints are encrypted on disk.
At boot, a short-lived guest process hands the key over stdin to the bridge's private
Unix socket, then the host discards its key buffer. Neither argv nor environment carries
the key. The guest retains only the decrypted token in memory. Restart/resume rotates
both key and token; guest MCP clients use the private socket plus the existing per-thread
authentication. Destroy removes the Keychain entry. Reconnect after an external guest
stop retires the old host connection pool before provisioning the next generation.

Read-only prevents changing the host login, but a bot can still read, copy or send it.
Turning the option off cannot erase a copy the bot already made. Reset the VM to erase
guest copies; revoke the provider login separately if necessary. These risks appear
next to the unchecked opt-in. Changing providers clears the opt-in unless it is
explicitly supplied again. Claude's macOS Keychain-only login is never exported.

Without sharing a host login, authentication belongs to the guest. After the first
unauthenticated turn has created its machine, identify it with `container list --all`
and run `container exec -it --user 1000 --env HOME=/workspace/.home <id> codex login`
or the equivalent Claude login. Do not mount a host provider directory.

## Tools and Preview

VM process definitions are scoped by bot, resolve cwd inside `/workspace`, and receive
only explicit process environment entries. Port detection uses guest `ss` and process
groups. A localhost TCP relay runs argv-based `socat` inside the guest, so ports can be
forwarded dynamically, including services listening only on guest loopback. Preview
gets `http://127.0.0.1:<host-port>` and the bot ownership; the existing Preview guard
continues to apply. Relay sockets close on stop/destroy.

Chromium runs headed on guest Xvfb `:99`, stores its profile in the volume, and exposes
CDP through the same loopback relay. Browser engines and tab profiles are per VM bot;
guest browser failure never launches a host browser. MCP uses an outbound connection
pool to the guest relay, then the existing authenticated host Unix gateway. No host
LAN listener, DNS changes, UI bearer token or shared MCP-token directory is exposed.

Default VM computer tools operate Xvfb via a guest-only helper. They do not call host
permissions, screen capture, input or the Mac HUD. Enabling **Permitir computer use na
tela do host** explicitly selects the existing host controller, which still requires
the normal temporary grant. Computer use must also be enabled on the bot.

## Validation and measured results

No touri GUI was launched and no host screen was captured. Host credentials were not
used in integration tests. The fake-provider unit suite covers lazy creation, concurrent
leases, reuse, idle stop, reset/delete, failure state, credential opt-in/revocation and
redaction, VM computer routing, browser failure routing and forwarded Preview ownership.
The real integration is automatically gated on Apple `container` availability. It creates
a disposable bot, runs a fake Codex protocol CLI in Linux, validates the MCP bridge,
forwards an HTTP service, connects to Chromium CDP, restarts, verifies persistent data
and destroys both VM and volume in `finally`.

Measured on this Mac with the existing cached `touri-bot:1` image:

| Measurement | Result |
|---|---:|
| First bot creation + boot + turn provisioning | 20.45 s |
| Warm start of the existing stopped VM | 0.68 s |
| Restart, including stop | 3.66 s |
| Guest memory used estimate, with Chromium/Xvfb/MCP | 375 MiB |
| Configured guest memory cap (historical measurement) | 2048 MiB |

Memory is `MemTotal - MemAvailable` from `/proc/meminfo`, not a measurement of every
host virtualization overhead. The first-create figure excludes a cold image build.
The earlier failed build filled the host disk; build cache/intermediates were cleaned,
the existing image was reused, and the builder was removed/stopped. Final resource
checks must show no disposable test containers or volumes and no running builder.

Required checks: `bun run typecheck`, `bun run lint`, UI Vitest,
`TOURI_BROWSER_HEADLESS=1 bun test sidecar/test` (by directory when needed), and
`cargo test`. Real-provider login turns remain opt-in; the automated integration uses
fake CLIs to avoid sending prompts or credentials to a model provider.

Final checks: typecheck and lint passed; UI Vitest 41 passed; sidecar by directory
181 passed and 2 personal-CLI smokes skipped; Rust 15 unit + 9 acceptance tests passed.
