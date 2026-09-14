# Durable foundation

SQLite stores runs, tasks, immutable evidence, reports, saved notes, and AI
accounting in nine tables. Its `user_version` tracks numbered migrations without
a migration table. Foreign keys reject broken references; unique indexes reject
duplicate tasks, double-counted reviews, multiple active runs/tasks, and concurrent
AI attempts. WAL mode permits reads while another connection writes. A five-second
busy timeout waits briefly for a competing write to finish.

Use `openDatabase()` in Bun server code. `shared/types.ts` has browser-safe types,
bounded JSON validation and settings validation. Keep requests and provider calls
outside `transaction()`, `checkpointTask()` and `completeTask()` callbacks; these
callbacks perform synchronous local writes only. Page evidence and its next cursor
must commit together through `checkpointTask`. Results and completion commit
together through `completeTask`. Call `saveSource` within those callbacks.

The fixed pipeline moves through discovery, optional candidate review, collection,
analysis, grouping and provisional opportunities, verification, and report assembly.
A stage planner supplies stable stream/batch/check keys. `server/research.ts`
supplies the real handlers used by the default worker. A discovery
result with `noMatchingApps: true` moves directly to an actionable report task.

Run actions use `pauseRun`, `cancelRun`, and `resumeRun`. Candidate review requires
`reviewed: true`; budget continuation can raise `budgetUsd`. The worker claims one
task with a new attempt ID. An old attempt cannot commit after pause, cancellation,
or replacement. Provider usage can still be recorded after cancellation because
an aborted request may have cost money. Failed tasks get a fresh bounded retry
window after explicit Resume, while lifetime attempt counts and collection request
counts remain preserved.

`collectionReuse` distinguishes complete fresh reuse, same-run checkpoint resume,
and replacement. `replaceCollectionTask` preserves the earlier segment and sources
as superseded history, starting a new version with no cursor. Both versions' request
counts contribute to the run safety limit. New runs never extend an old run's cursor.
Unverified review identities cannot become selected/countable evidence.

For paid work, call `reserveAi` before dispatch. The Responses API adapter must
bound the serialized input conservatively, enforce the supplied output-token limit,
and use standard-tier pricing corresponding to the persisted catalog entry. Pass
provider usage and a known actual charge separately to `finalizeAi`. Usage produces
a pricing-derived estimate; it is not mislabeled as an actual recorded charge.
If the response/usage is lost, call `markAiUnknown`; the worker also preserves an
unsettled reservation when a handler ends or the process restarts. Unknown costs
pause further paid work for that run until usage or a charge is reconciled. The
catalog is configurable and unknown pricing pauses continuation. No API keys are
stored in SQLite. Each stage call and its bounded repair has a distinct request key
within the worker attempt, preserving duplicate-dispatch prevention.

The worker takes a process-lifetime `flock` advisory lock through an isolated Bun
FFI module. This was tested on macOS with Bun 1.3.14, including second-process
refusal and automatic release on SIGKILL. Linux code is present but not verified
here. Use one canonical local database path, not hard-linked database aliases or
network filesystems. Do not remove the `.worker.lock` file while a process may own
it; the kernel lock, not the file's existence or age, establishes ownership.

Heartbeat status is stored as the `worker_status` settings record every five
seconds and on clean shutdown. At 20 seconds it becomes nonresponsive. It is UI
information only, never permission to take over a lock. On startup, formerly
running runs become paused/interrupted, active attempts are invalidated, and paid
attempts without settled accounting become unknown. Queued work remains eligible;
manual/interrupted work requires Resume. Browser closure does not stop the worker;
machine sleep may suspend it. Recovery covers committed local data, not disk loss
or corruption.
