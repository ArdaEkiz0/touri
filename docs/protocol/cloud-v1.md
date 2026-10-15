# touri cloud HTTP/WS protocol v1

Status: Phase 1, **sandbox only**, 2026-10-13. This is an Apache-2.0 public interoperability contract. A compatible implementation may be self-hosted. No private package, schema, container image, domain, payment-provider SDK or infrastructure credential is required to build or test the desktop. Public DTOs are exported from `packages/contracts/src/cloud.ts`; the reference fixture is `test/fakes/fake-cloud.ts`.

The cloud hosts the **whole bot runtime**: engine, CLI with a user-supplied API key, MCP, history, files, routines and processes. The desktop is a controller/viewer. Desktop disconnect/quit releases viewers and streams; it MUST NOT park machines, cancel runs or stop cloud schedules. Local and local VM use remain free and require no account. Cloud OAuth/subscription logins, Mac environment, Keychain contents and filesystem mounts are never inherited. The minimum commercial plan is **R$ 79,99/month**, with catalog/allowances supplied by the server; Phase 1 never creates charges or production resources.

## Versioning, transport and authorization

The configured base URL is an origin, e.g. `https://compatible.example`; there is no compiled default host. HTTPS/WSS are mandatory except `http://127.0.0.1`, `http://localhost` and `http://[::1]` for sandbox tests. Userinfo, fragments, non-v1 paths, bearer query parameters and redirects are rejected. Every HTTP response and request carries `Touri-Cloud-Version: 1`. An incompatible version fails closed with `TOURI-E9007`. Breaking changes use `/v2` and a new major version. Additive fields are optional; capabilities must be negotiated, never assumed.

HTTP JSON bodies use UTF-8 and `Content-Type: application/json`. Authenticated requests use `Authorization: Bearer <accessToken>` in the sidecar. Tokens MUST NOT enter renderer responses, events, logs, URLs, argv, exports or plaintext settings. Server authentication resolves tenant/account from the credential; every bot, machine, operation, process, volume, snapshot, thread and approval checks that ownership. IDs of absent or foreign resources both return 404. Billing changes require owner role. Client `tenantId` is never authoritative.

All mutations carry a device-generated `Idempotency-Key` (1–128 printable characters). The server records account + key + method + path + canonical request body and the durable outcome. Same key/body returns the same outcome, including asynchronous operation ID; different body/method/path returns `TOURI-E9005` (409). Retain at least 24 hours, and runtime `sendId` dedupe for the lifetime of the thread. Ambiguous timeouts are reconciled with the original key, never replayed with a new key. Authorization and generation are revalidated on replay. Device token exchange and refresh are exceptions: a reused one-time code/refresh token is rejected, never replayed as fresh credentials.

`GET /v1/capabilities` is unauthenticated and returns:

```json
{
  "protocolVersion": 1,
  "sandbox": true,
  "runtime": "whole-bot",
  "auth": "byok-api",
  "imageVersions": ["sandbox-v1"],
  "capabilities": ["exec", "processes", "snapshots", "volumes", "desktop", "pty", "cdp", "preview"]
}
```

The Phase 1 client refuses `sandbox:false`, other runtime/auth modes and images outside the negotiated allowlist. Unsupported operations return `TOURI-E9009`, never an empty success. `workspace-import` is a reserved capability: Phase 1 deliberately refuses implicit imports of Mac directories; a later explicit filtered export/handoff must exclude secrets, cookies, `.env`, SSH credentials and native CLI rollouts, including Git-tracked copies.

## Device pairing and revocable tokens

| Method/path | Request | Success |
| --- | --- | --- |
| `POST /v1/device/authorizations` | `{deviceName:string}` | `200 {deviceCode,userCode,verificationUri,expiresAt,intervalSeconds}` |
| `POST /v1/device/token` | `{deviceCode:string}` | `200 CloudTokens` |
| `POST /v1/tokens/refresh` | `{refreshToken:string}` | `200 CloudTokens` |
| `DELETE /v1/devices/:deviceId` | `{}` | `200 {}` |

`CloudTokens = {deviceId,accessToken,refreshToken,expiresAt}`. Authorization code TTL is 10 minutes, polling interval at least 5 seconds; `TOURI-E9010` means pending, `TOURI-E9006` means slow down, `TOURI-E9011` means expired/denied/used. `verificationUri` is a same-origin HTTPS web page that accepts the short user code, authenticates the user and explicitly confirms account + device. The secret `deviceCode` MUST NOT appear in the URL or renderer. Pairing alone never purchases a plan.

Access token TTL is 5 minutes. Refresh rotates on every use; the server stores hashes and a revocable device family. Refresh reuse revokes the whole family. The sidecar serializes concurrent refreshes and persists both tokens in Keychain under an origin-specific account before claiming connected. Keychain failure blocks pairing without plaintext fallback. Endpoint changes never reuse old-origin credentials. Device revoke terminates HTTP/WS access within 60 seconds; the fake does so immediately. Unpair/revoke is distinct from subscription cancellation, bot parking and entitlement suspension.

## Account, plan and usage

| Method/path | Success DTO |
| --- | --- |
| `GET /v1/account` | `{id,name,role:"owner"|"admin"|"member",deviceId}` |
| `GET /v1/plan` | `{name,priceCentavos,currency:"BRL",status,includedSeconds,storageBytes,subscribeUrl,sandbox:true}` |
| `GET /v1/usage` | `{usedSeconds,includedSeconds,storageBytes,storageLimitBytes,updatedAt}` |

Plan status: `pending|active|past_due|suspended|canceled`. All money uses integer BRL centavos; minimum price 7999. `subscribeUrl` is a same-origin `/v1/…` web link, never a tokenized checkout URL. Desktop only opens that link: no billing mutation is implemented in Phase 1. A mandate approved by a payment provider does not mean an invoice paid or an entitlement active. Usage counts box seconds in running since ready, including viewer/idle; two simultaneous boxes consume two box-hours. Provisioning/waking time is not charged. The server enforces plan/quota even with modified desktop UI; cached usage is timestamped and never used to infer entitlement.

## Whole-runtime bot and machine lifecycle

| Method/path | Request / result |
| --- | --- |
| `POST /v1/bots` | `{id,name,provider:"codex"|"claude",model,instructions,access,approvals,browserEnabled,computerUse,mainThreadId,auth:"byok-api"}` → `201 {id}` |
| `DELETE /v1/bots/:id` | `{confirm:true}` → `200 {}`; revokes BYOK grants and deletes bot metadata/tasks after machine deletion |
| `PATCH /v1/bots/:id` | Mutable bot configuration above, without identity/auth/provider credentials → `200 {}` |
| `PUT /v1/bots/:id/key` | `{provider,apiKey}` → `200 {}`; key never echoed, browser UI password field, explicitly granted per bot |
| `POST /v1/machines` | `{botId,size:"small",imageVersion}` → `202 CloudOperation` |
| `GET /v1/machines/:id` | `200 CloudMachine` |
| `POST /v1/machines/:id/start` | `{generation}` → `202 CloudOperation` |
| `POST /v1/machines/:id/park` | `{generation}` → `202 CloudOperation` |
| `POST /v1/machines/:id/wake` | `{generation}` → `202 CloudOperation` |
| `DELETE /v1/machines/:id` | `{generation,confirm:true}` → `202 CloudOperation` |
| `POST /v1/machines/:id/intent` | `{intent}` → `200 {accepted:true}` |
| `GET /v1/operations/:operationId` | `200 CloudOperation` |

`CloudMachine = {id,botId,generation,state,imageVersion,volumeId,progress,usage}`. `volumeId` is an opaque persistent reference, not a host path. `CloudOperation = {operationId,status:"pending"|"succeeded"|"failed",machine,error?:{code}}`. Poll until terminal, bounded to 180 seconds; pending is not ready. Create starts the whole runtime in the sandbox. Server authorization requires a BYOK key and valid entitlement before allocation. No host environment, arbitrary image, mount, entrypoint, ports or host resource size is accepted.

States: `absent → provisioning → running → parking → hibernated → waking → running`, also `error`, `deleting`, `deleted`, `suspended`. Suspension blocks wake and preserves data. Wake rotates generation and grants; one fenced writer per bot/volume. Park flushes durable SQLite/history/files/cookies, drains runs/processes with 30 seconds grace, revokes channels and releases compute; RAM/process/TCP preservation is not promised. Delete revokes grants and deletes durable resources; it never silently cancels another bot's subscription. Lifecycle is account- and generation-fenced. Old-generation actions fail with 409.

Intents: `composer-focus|composer-typing|computer-open|computer-visible|computer-hidden|foreground|background|idle`. Background only releases presence, never parks/cancels a run. Optional pre-thaw is quota-aware, debounced 30 seconds. Defaults: park after 15 minutes without active run/exec/viewer, no automatic paid expansion. Cloud scheduler owns due slots, `(botId,routineId,scheduledFor)` dedupe and overlap/catch-up. The local engine and local scheduler MUST refuse cloud execution. Full Linux host extraction/deployment and metering are subsequent phases; Phase 1 supplies the interoperable controller and a fake autonomous runtime, not a production cloud service.

## MachineConnection, fencing and sealed connection

`POST /v1/machines/:id/connections {generation}` returns only after running:

```json
{
  "protocolVersion": 1,
  "generation": 7,
  "state": "running",
  "expiresAt": "2026-10-13T18:05:00Z",
  "transport": "gateway-wss",
  "connection": {
    "machineId": "opaque-machine",
    "provider": "remote",
    "endpoints": {
      "browser": "https://compatible.example/v1/machines/opaque-machine/gateway/9222",
      "bridge": "wss://compatible.example/v1/machines/opaque-machine/runtime?generation=7"
    },
    "ports": [],
    "display": {"name": ":99", "width": 1440, "height": 900},
    "bridge": {"guestPort": 9876, "socketPath": "/tmp/touri-mcp.sock", "connectionFile": "/workspace/.touri/run/connection.sealed.json"},
    "authKeyId": "sha256-of-boot-key"
  },
  "channels": {
    "runtime": "wss://compatible.example/v1/machines/opaque-machine/runtime?generation=7",
    "desktop": "wss://compatible.example/v1/machines/opaque-machine/desktop?generation=7",
    "pty": "wss://compatible.example/v1/machines/opaque-machine/pty?generation=7",
    "cdp": "wss://compatible.example/v1/machines/opaque-machine/cdp?generation=7"
  },
  "forwards": [
    {"guestPort": 9222, "path": "https://compatible.example/v1/machines/opaque-machine/gateway/9222", "transport": "http"}
  ]
}
```

The client validates version, ID, running state, monotonic generation, expiry and **every** channel/forward origin/scheme/path before connecting. `ports:[]` is mandatory; the cloud never chooses ports on the Mac. `authKeyId` is an identifier, not a key. Only the sidecar sees upstream descriptors; renderer sees safe status/usage and local gateway paths. Gateway grants expire with the envelope and revalidate generation/ownership/entitlement. HTTP forwards carry `Touri-Machine-Generation`; WS forwards carry the non-secret `generation` query parameter. The gateway rejects an old generation even while the owner token is valid.

Sealed workload connection v2 retains AES-256-GCM with independent random 12-byte nonce and 16-byte authentication tag. AAD is UTF-8 JSON in this property order:

```json
{"generation":7,"expiresAt":"2026-10-13T18:05:00Z","version":2,"algorithm":"aes-256-gcm","machineId":"opaque-machine","keyId":"sha256-of-boot-key"}
```

Envelope adds base64 `nonce`, `ciphertext`, `tag`. Plaintext is `{connection,token,desktopPasswordFile?}`. Workload validates expected machine, key hash, generation and expiry after decrypting and before using the descriptor. The 32-byte boot key is handed off by authenticated workload stdin/socket, **never alongside the envelope**, env/argv or management HTTP response. Rotate on boot/wake; mode 0600, exclude seal/key/tokens from backups. Local v1 remains compatible. TLS/sealing are not E2EE against the service operator. Workload tokens are short-lived bot/machine/generation-scoped and cannot access the account control database, billing credentials, other tenants or Mac `callHost`.

## Exec, PTY/processes, CDP, Preview and desktop/VNC

| Method/path | Contract |
| --- | --- |
| `POST /v1/machines/:id/exec` | `{generation,command,args:[],cwd:"/workspace",env:{}}` → `{code,stdout,stderr}` |
| `POST /v1/machines/:id/processes` | Same plus client `processId` UUID → `{path:WSS}` |
| `POST /v1/machines/:id/desktop-sessions` | `{generation,control:false}` → `{path:WSS,password:string}` (sidecar only) |
| `GET /v1/machines/:id/gateway/:authorizedPort/*` | Authenticated Preview HTTP or CDP HTTP/WS, generation fenced |
| `POST /v1/machines/:id/snapshots` | `{}` → `{path:HTTPS}`; GET downloads authenticated octet stream |
| `POST /v1/volumes` | `{name}` → `{name:opaqueReference}` |
| `DELETE /v1/volumes/:reference` | `{confirm:true}` → `{name}` |

`exec` argv/cwd/env are allowlisted server-side, never merged with the desktop environment. PTY/process frames are JSON: client `{type:"stdin",data:base64}`, `{type:"eof"}`, `{type:"signal",signal:"SIGTERM"|"SIGKILL"|"SIGINT"}`; server `{type:"stdout"|"stderr",data:base64}`, `{type:"exit",code:number|null,signal:string|null}`. Max decoded data frame 64 KiB; bounded buffering/backpressure; errors terminate the handle. Remote handles carry `target:"remote"`, `remoteProcessId` and sentinel `pid/pgid:0`; they MUST NOT be registered, reaped or killed as host PIDs. Process allocation precedes WS upgrade; cancel remains scoped to that process.

WebSockets authenticate by sidecar Authorization header. No bearer query strings. If a browser-origin client ever needs authentication, exchange a single-use 15-second ticket and send it in the first frame, before any payload; do not add ticket/bearer to the URL. Phase 1 browser views authenticate to the local sidecar and never hold cloud tokens.

Desktop gateway transports binary RFB 3.8 bytes. `desktop-sessions` issues a one-use 15-second grant and a random 8-character VNC password to the sidecar. The gateway tunnels authenticated upstream VNC; the sidecar answers its challenge and filters renderer input through the existing `DesktopInputGate`. Default observe-only; control requires both bot permission and a revocable server grant. Revocation closes streams and releases keys within 1 second. Renderer gets neither password nor cloud URL. No unauthenticated public VNC/PTY/CDP port. PTY can use the framed process protocol above, or an explicitly advertised binary `pty` gateway. CDP uses standard JSON frames; the loopback proxy rewrites `webSocketDebuggerUrl` and injects credentials privately. Only descriptor-authorized Preview/CDP ports are forwarded at `127.0.0.1:0`, never `0.0.0.0`; redirects are refused. MCP stays inside the cloud runtime.

## Runtime HTTP and resumable events

| Method/path | Contract |
| --- | --- |
| `POST /v1/bots/:id/messages` | `{threadId,parentId,text,attachmentIds:[],clientNonce,deadline?}` → `{message,run}` using shared Message/Run DTOs |
| `GET /v1/threads/:id/messages` | `{messages,activeLeafId}` |
| `GET /v1/threads/:id/transcript?since=N&limit=N` | `{entries:[{seq,generation,event}],lastSeq,generation,hasMore,resync}` |
| `GET /v1/threads/:id/runs` | `{runs}` |
| `POST /v1/runs/:id/cancel` | `{}` → `{run}` |
| `POST /v1/approvals/:id/respond` | `{decision:"approved"|"denied",standing?:boolean}` → `{}` |
| `WS /v1/events?since=cursor` | Account-authorized event stream below |

`clientNonce` is the durable `sendId`; it is also the Idempotency-Key. A repeated send after disconnect creates exactly one message/run. One writer per thread. Whole-runtime APIs do not start a CLI on the desktop. Attachments/host import are unsupported in Phase 1; return `TOURI-E9009`, never silently ignore.

Event frames: `{cursor:string,botId:string,generation:number,event:UiEvent}`. Cursor is account-scoped, monotonically increasing and resumable; reconnect sends the last accepted cursor. At-least-once delivery requires client dedupe. If retention cannot replay, server sends `{resync:true,cursor}`; desktop requests durable transcript/messages. Never treat a replay gap as an empty up-to-date transcript. Old machine-generation frames are rejected. Machine lifecycle events contain safe `MachineState` with `cloud:{state,generation,usage}` and no descriptor/token. Device revoke closes events within 60 seconds. Bot routines and offline approvals are owned by the cloud runtime; approval timeout is 30 minutes and defaults to deny/checkpoint/park, never local implicit approval. Actual remote routine/approval persistence is subsequent server/runtime work, not emulated by local execution.

## Errors and limits

Every non-2xx error is `{code,message,retryable,requestId}`. Never include raw exception, token, provider key, internal IP/path or database record. WS close 1008 means authorization/fence/revoke, 1013 means capacity/backpressure, 1011 means service failure. All codes below are public and also registered for localized desktop errors.

| Code | HTTP | Meaning |
| --- | --- | --- |
| TOURI-E9000 | 503 | Service/network/capacity unavailable; retryable |
| TOURI-E9001 | 401 | Missing/expired/revoked credential |
| TOURI-E9002 | 403 | Policy/control/role denied |
| TOURI-E9003 | 404 | Absent or foreign resource |
| TOURI-E9004 | 402 | Entitlement/saldo suspended |
| TOURI-E9005 | 409 | State, generation or idempotency conflict |
| TOURI-E9006 | 429 | Quota/rate limit; retryable |
| TOURI-E9007 | 400 | Incompatible/invalid protocol or descriptor |
| TOURI-E9008 | 403 | Invalid/foreign transport origin |
| TOURI-E9009 | 501 | Capability unsupported |
| TOURI-E9010 | 428 | Device authorization pending; poll interval applies |
| TOURI-E9011 | 401 | Device code expired, denied or consumed |
| TOURI-E9012 | 503 | Secure credential storage unavailable; no plaintext fallback |
| TOURI-E9013 | 403 | Cloud feature disabled |
| TOURI-E9014 | 403 | Sandbox/BYOK/runtime requirements violated |

Server initial limits: exec/run 60 minutes, upload 100 MiB with chunks ≤1 MiB, 64 KiB log frames, 2 viewers/box, 60 control commands/minute/device, 10 wakes/minute/account, VNC input 120 frames/second. Authoritative enforcement belongs to the server. Workloads require validated per-bot sandbox isolation and deny management/metadata/private/other-tenant egress; TLS/descriptor checks are not a substitute for that isolation. Production rollout and actual billing are outside this implementation.

## Open-repo configuration and compatibility testing

Settings: `{cloud:false,cloudBaseUrl:""}` by default. Opt in through the local settings API `PATCH /api/v1/settings {cloud:true,cloudBaseUrl:"http://127.0.0.1:PORT"}` in an isolated sandbox profile. No environment-selected official host. Preferences → Nuvem edits the endpoint, pairs/unpairs, shows server plan/usage and opens web subscription. New bot → Computador offers Na nuvem only after pairing, and explicitly requests an API key. The renderer never receives device/access/refresh tokens.

`TOURI_VM_INTEGRATION=0 bun test sidecar/test/cloud` exercises the public fake, including auth, revocation, ownership, fences, lifecycle, streaming process cancel, loopback proxies, sealed AAD and desktop-independent run completion. Unsupported migration deliberately returns 501. The fake uses no containers and performs no paid or production action. Real Linux workload extraction, infrastructure isolation, quota accounting, billing, restore and rollout remain C2–C6 work in the original specification.

## Problem reports

`POST /v1/reports` accepts `multipart/form-data` with one file field named `report`
(`application/zip`, filename `report.zip`). The ZIP contains `report.json`, optional
`logs/*.log` and optional `images/*`. Maximum ZIP size is **10 MiB (10,485,760 bytes)**;
the server must enforce this while streaming, bound multipart overhead to 64 KiB,
and return 413 for excess size. Do not set a JSON Content-Type on this request.
Normal bearer authorization, `Touri-Cloud-Version: 1`, same-origin transport,
redirect refusal and account/device ownership apply. Sending is available only
with the desktop `cloud` flag enabled and a connected account.

Success: `201 { "id": "report-id" }` (opaque ID, 1–200 ASCII letters, digits,
underscores or hyphens). Include `Touri-Cloud-Version: 1` in the response. Use the
prepared local report ID as `Idempotency-Key`; compare the account + method + path
+ SHA-256 of the ZIP, return the same ID on retry, and reject a changed ZIP with
409 / `TOURI-E9005`. Revalidate device authorization on every retry. Reports are
account scoped; this endpoint grants no access to other accounts' reports and
does not require a paid plan. Validate archive entry names and decompressed size
before processing; never extract absolute paths, symlinks or `..` entries.

The desktop freezes and redacts text before its full preview. Registered kernel
secrets, keys, tokens, passwords, cookies, Authorization headers, emails, CPF,
Brazilian phone numbers and public IPv4 addresses are masked. Private/loopback
IPs are allowed; home paths become `~`. Images are re-encoded to remove metadata;
users review pixels and can cover sensitive regions before preparing the report.
Transcripts are off by default and require selecting a conversation and explicit
opt-in. Run diagnostics contain metadata only, never message/error-message text.
The server must treat all report contents as sensitive support data and must
never copy ZIP contents, credentials or transcripts into ordinary request logs.

The GitHub issue action includes only the previewed summary, with manual ZIP
attachment. Repository resolution: explicit form configuration, then
`TOURI_REPORT_REPOSITORY` (HTTPS GitHub repository URL), then `package.json`'s
`repository` string or `repository.url`. There is no hardcoded repository or cloud
endpoint. Export creates a new private file in the desktop Downloads directory;
the browser variant uses its normal download destination.

Local history stores only ID, date, redacted title and destination, capped at 100
entries. GitHub entries mean the issue composer was opened, not that an issue was
published. If the sidecar is down, desktop reports include available shell logs
and versions and explicitly mark unavailable diagnostics; offline history is
kept in renderer local storage until the next connected report session.
