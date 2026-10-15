# Schema 7 history backfill

The shipped `sidecar/src/kernel/migrations/0007.sql` is unchanged, including its
DDL, triggers and version. `openDatabase` applies its DDL sections and defers its
bulk message resequencing and initial transcript insert. No new migration or
schema version is introduced.

## Cause and behavior

Previously startup rewrote every legacy message, copied its complete text and
parts into `transcript_entries`, and copied those entries again into
`ui_event_log` in the event bus constructor. Retention ran after those allocations
and deletes did not return allocated SQLite pages to the filesystem. Historical
messages thus occupied multiple large copies before the server could listen.

Startup now counts message keys by thread and reserves each historical sequence
range. This small indexed metadata scan prevents live inserts, updates and deltas
from colliding with the reserved revisions. It stores progress under
`settings["transcript.backfill.7.thread." + threadId]` as
`{ threadId, done, total }`. Empty and already-upgraded databases need no backfill.

After `Bun.serve` is listening, the worker rewrites at most 64 messages per
transaction, with an 8 ms processing budget between rows and 10 ms between
batches. One exceptionally large row or building the active thread's narrow
ordering cache can exceed that budget. The cache contains only IDs and sequence
numbers in a temporary table; it avoids sorting message bodies on every batch.
On restart it is rebuilt from the persisted progress marker. Each batch commits
its data and progress together. A rollback or quit repeats only unfinished work.

Historical entries contain compact message references. Transcript reads resolve
those references from the message projection. Pending threads request resync and
hydrate their existing legacy message rows through `/messages`; they stay usable
while migration runs. Live revisions continue using the existing durable journal.
Historical references never enter `ui_event_log`, including after a restart or
interleaved live publications.

The existing replay limits (2,000 entries per thread and seven days) apply before
historical references are inserted. Final per-thread cleanup also accounts for
live revisions received between batches, without deleting unpublished live
entries. Message bodies, branches and FTS remain intact.

`GET /health` includes `historyMigration: { running, done, total }`. The UI polls
that status and displays a small pt-BR indicator, `Atualizando histórico… N%`,
until completion. A transient health failure is retried, including across a
reconnection; polling ends on unmount or completion.

## Verification

`sidecar/test/store/migration-backfill.test.ts` builds a synthetic legacy database
with 600 messages (3,203,072 bytes). On this Linux host, startup plus the first health
response took 56–343 ms while the worker remained pending. Completion produced
3,334,144 bytes (1.04×), below the 1.6× regression ceiling. The shipped synchronous
SQL plus event bus produced 9,412,608 bytes (2.94×) with the same input. These
synthetic measurements establish the duplication mechanism, not the exact 4.6×
ratio or 70-second duration reported for the production history.

The regression suite also checks health responsiveness during progress, legacy
reads, restart and transaction interruption, idempotence, live writes, count/age
retention, unchanged SQLite DDL, integrity and foreign keys. For retained history,
final messages, threads and hydrated entries are compared with the shipped
synchronous SQL. The initial health/progress regression failed on the old code
before implementation. The existing large-history/branch/FTS test now explicitly
finishes the background batches and checks age retention.

## Vacuum and existing databases

No automatic `VACUUM` is run. It rewrites the whole database, can need extra disk
space, and would occupy the sidecar connection for an unbounded interval. New
upgrades avoid the large copies; existing schema-7 databases retain their normal
compaction behavior and reuse free pages. An already-expanded file is not shrunk
by this change. Reclaiming its physical disk space requires a separate maintenance
operation with the app closed.

Mac application QA and Apple container tests are outside this Linux host validation.
No Rust files were changed; `cargo test` was not run because cargo is unavailable.

## Changed files

- `sidecar/src/kernel/db.ts`: apply the shipped DDL without synchronous data backfill.
- `sidecar/src/kernel/history-backfill.ts`: durable progress, bounded batches,
  sequence reservation, compact references, hydration and retention.
- `sidecar/src/kernel/index.ts`: start/stop the worker after listen and expose health progress.
- `sidecar/src/kernel/event-bus.ts`: skip historical references when recovering live events.
- `sidecar/src/store/index.ts`: legacy resync fallback and reference hydration.
- `packages/contracts/src/types.ts`: optional, backward-compatible health progress.
- `ui/src/features/history/HistoryMigrationStatus.tsx` and `history.css`:
  token-based pt-BR indicator and cancellable polling, mounted in `ui/src/App.tsx`.
- `sidecar/test/store/migration-backfill.test.ts`,
  `sidecar/test/store/transcript.test.ts`, `ui/test/history-migration.test.tsx`:
  regression coverage and the asynchronous upgrade expectation.
- `sidecar/test/vm/sealed-connection.test.ts`: import formatting only, required by
  the existing full-repository Biome check. No VM or Keychain behavior changed.

## Validation gates (r7, Linux host)

- `bun run typecheck`: passed. Because `bunx` is unavailable on the host, an
  ephemeral shell function forwards it to `bun x --bun`; no package script was changed.
- `bun x biome check .` and `git diff --check`: passed.
- `cd ui && bun run test --maxWorkers=1`: 258 passed in 28 files, with the default
  test timeouts. The owned full-sidecar attempt was briefly paused to reduce CPU
  contention, then resumed. Earlier concurrent UI runs hit timing failures;
  reconnect integration regressions were fixed by removing an unnecessary
  connection subscription from the indicator and keeping health polling.
- The four targeted backend files (`migration-backfill`, `transcript`,
  `kernel/kernel`, `vm/sealed-connection`): 53 passed, 298 assertions. Latest
  synthetic startup/health measurement: 56 ms, with unchanged 1.04× size growth.
- `bun test sidecar/test/runtime/runtime.test.ts`, run separately after failures
  in the full run: 38 passed, 177 assertions, 9.46 seconds. No runtime code was changed.
- The full `timeout 1800 bun test sidecar/test` was attempted exactly once. It
  exited 124 at 30 minutes: 11 runtime failures were recorded during the initial
  concurrent load, then the runner stopped reporting progress after
  `transcript: cancellation during environment loading never launches the queued turn`.
  The last open fixture had a canceled run and zero history-backfill markers.
  All 38 tests in that same runtime file passed when run separately. This full
  attempt is not a green suite; the timing/runner issue remains deferred outside
  the migration package. Logs remain in `.r7-sidecar-test.log`,
  `.r7-runtime-isolated.log`, and `.r7-ui-test.log` (ignored, unstaged).
