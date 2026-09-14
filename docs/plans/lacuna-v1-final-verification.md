# Lacuna v1 final verification

Verified on 2026-09-14 from the repository root with Bun 1.3.14. This record
separates fresh automated/process evidence from work that needs real stores,
credentials, or product investigation. No live OpenAI request was made.

## Result

The local implementation passed its locked install, complete automated suite,
typecheck, lint, production build, idempotent migrations, SQLite backup check,
focused worker-process test, and a loopback production smoke request. The
implementation is ready for local use within the documented limitations below;
that result is not a claim that production store or paid-AI integrations have
been proven.

## Fresh command evidence

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Exit 0. Bun reported `Checked 578 installs across 584 packages (no changes)` in 106 ms. |
| `bun run test` | Exit 0. `113 pass`, `0 fail`, `624 expect() calls`, across 8 files in 11.68 s. This includes the real-process lock, SIGKILL release, crash recovery, cancellation/late-result, database contention, task deduplication, budget, cursor, collection-identity quarantine, source safety, pipeline, UI, and supervisor contracts. |
| `bun run typecheck` | Exit 0: `react-router typegen && tsc --noEmit`. |
| `bun run lint` | Exit 0: `eslint .`. |
| `bun run build` | Exit 0. React Router/Vite built the client and server bundles; client build took 152 ms and server build 48 ms. |
| `LACUNA_DB_PATH="$verify_db_dir/lacuna.sqlite" bun run migrate` twice, where `verify_db_dir=$(mktemp -d /private/tmp/lacuna-final-migrate.XXXXXX)` | Both runs exited 0 and reported schema 2 for `/private/tmp/lacuna-final-migrate.UudyqV/lacuna.sqlite`. A subsequent query reported `{"version":2,"tables":9}`. This proves an empty database migrates and a second invocation is idempotent. |
| `sqlite3 "$backup_verify_dir/source.sqlite" ".backup '$backup_verify_dir/backup.sqlite'"`, after migrating a temporary database | Exit 0. Both source and backup reported `PRAGMA user_version` 2; the backup contained 9 non-internal tables. This is the command documented for a consistent SQLite backup. |
| `bun test tests/worker.test.ts` | Exit 0. `5 pass`, `0 fail`, `18 expect() calls` in 2.62 s. The first real-process case explicitly verifies second-worker refusal, stale-heartbeat non-takeover, path canonicalization, and lock release after `SIGKILL`. |
| `LACUNA_DB_PATH="$verify_smoke_dir/lacuna.sqlite" bun run start` plus `curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3000/` | Exit 0 with a 6,116-byte HTML body containing `<title>Lacuna</title>`. The server reported `http://localhost:3000 (http://127.0.0.1:3000)` and `GET / 200`. |
| `git diff --check` | Exit 0 with no whitespace errors. |

The initial loopback smoke attempt inside the filesystem sandbox could not bind
`127.0.0.1:3000` (`EPERM`). The same required smoke check was then run with the
normal one-time local-listener permission and passed. This was an environment
restriction, not an application failure.

## Repository and security metadata

Inspected after the checks above:

- `package.json` provides the required Bun scripts: `dev`, `dev:web`, `worker`,
  `migrate`, `test`, `typecheck`, `lint`, `build`, and loopback `start`.
- Root lockfile inspection found only `./bun.lock`; no root `package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock`, or `pnpm-lock.yaml` exists. `bun.lock` is
  therefore the sole project package-manager lockfile.
- `.gitignore` excludes dependencies, build output, React Router generated
  output, `.env`/`.env.*` (while allowing a future `.env.example`), `data/`,
  `logs/`, and `*.log`. `git check-ignore -v` confirmed these rules for
  `node_modules`, `build`, `.react-router`, `.env`, `data/lacuna.sqlite`, and
  `logs/worker.log`.
- Source inspection found the API key only as the server/worker environment
  variable `OPENAI_API_KEY`; settings expose configuration status and setup
  guidance, not the key. The test suite uses deterministic transports and makes
  no OpenAI call.

## Blueprint requirements audit

| Blueprint area | Fresh evidence and implementation review | Status |
| --- | --- | --- |
| Project shape and scripts | One TypeScript/React Router/Bun repository has independent web and worker entry points; the local supervisor starts both. `bun run build` and the loopback production smoke passed. The app binds its documented production command to `127.0.0.1`. | Verified locally |
| Migrations, SQLite state, and worker recovery | `server/db.ts` applies two numbered migrations inside a transaction, enables foreign keys/WAL/a busy timeout, and the temporary-database check produced schema 2 with 9 tables twice. The full and focused worker suites cover checkpoint commit, crash/interrupt recovery, explicit resume, contention, and queue eligibility. | Verified locally |
| Singleton worker | `server/worker-lock.ts` takes a process-lifetime OS advisory lock before opening the database or scheduling work. The focused real-process test verified refusal, non-takeover from stale status, canonical paths, and release after forced termination. | Verified locally on macOS/Bun 1.3.14 |
| Collection identity and trust | Store adapters retain store/app/review identifiers and locale provenance. The pipeline prevents untrusted or conflicting IDs from selection, numeric support, and reuse; tests cover cross-page/cross-locale quarantine and replacement history. | Verified conservative behavior; real identity stability remains unverified |
| Source safety and website collection | The web collector validates public destinations and every redirect, pins validated addresses to the request, respects same-site/robots/byte/time/page limits, and marks failures `Not verified`. Collector tests cover private, link-local, mapped IPv6, redirects, denial, script-only, and bounded page cases. | Verified with deterministic network tests; live website compatibility is unverified |
| AI reservation and structured output | `reserveAi` persists a conservative maximum before dispatch and permits one in-flight request. Unknown/lost responses remain charged reservations and pause continuation. The prompt schemas, literal citations, provenance checks, bounded repair, and prompt-injection handling are covered by tests. | Verified without a provider call; paid behavior/cost needs a user-key trial |
| Reports, sampling, and confidence | Versioned policy tests cover preset ceilings, equal allocation/redistribution, candidate diversity, rating/recency selection, repeated/no-new-ID stopping, counterpart ambiguity, and confidence boundaries. Research tests cover counts, citations, translations, gaps, and no fabricated absence. | Verified with deterministic fixtures |
| Interface, accessibility, theme, and fixtures | Workspace tests cover real actions, error associations, recovery/uncertainty states, source anchors, escaped hostile URLs, system/light/dark initialization, and polling cleanup/focus behavior. The development-only reference route labels sample states. | Verified by component/state tests; no separate manual cross-browser visual pass was run in this task |
| Saved notes and refresh | Refresh creates a new run from an immutable snapshot; saved notes/status remain attached to their original opportunity. Foundation, research, and workspace tests exercise this behavior. | Verified locally |

## Documentation changes

`README.md` was replaced with a current local-operator guide. It now covers:

- frozen Bun installation and safe ignored `.env` setup;
- migration, supervised and independent web/worker startup, loopback production
  startup, and `LACUNA_DB_PATH`;
- the one-worker lock, heartbeat meanings, explicit stop/resume recovery, and
  queued-run behavior;
- Quick/Deep ceilings, price reservations, uncertain charges, and review-ID
  quarantine;
- consistent SQLite backup and recoverable restore steps; and
- verified local mechanics versus unverified live integrations.

This file is the companion durable record linked by that README.

## Limits still requiring live evidence

None of the following was relabeled as verified:

1. **Repeat-store review identity trial.** The existing limited scraper run is
   only a point-in-time observation. Repeat fetches across sessions, sorts, and
   locales must establish ID stability and content-change behavior before real
   review IDs can support numeric counts or reuse.
2. **Paid OpenAI trial.** A user-provided key and an explicitly bounded budget
   are required to confirm a current supported model, actual provider usage,
   charges, and end-to-end structured output. This verification made no paid or
   live OpenAI call.
3. **Complete live research.** No full research run against live stores plus AI
   was performed, so real collection-to-report behavior is not production-proven.
4. **Platform feasibility.** The application deliberately keeps feasibility
   `not_verified` without authoritative platform evidence; it has not performed
   that research automatically.
5. **Scraper/provider operational limits.** The small documented trial does not
   prove future coverage, pagination, IDs, rate limits, locale overlap, response
   yields, availability, or provider behavior. The real adapters remain bounded
   and conservative until further measurement.

The known local lock test is specifically macOS/Bun 1.3.14 evidence. Linux code
exists but was not verified in this run. The visual/browser behavior was covered
through rendered component contracts, not a full manual browser matrix.

## Final multilingual and accessibility review fixes (2026-09-14)

- Every report evidence passage now displays the stored requested storefront and
  requested collection language, plus the stored detected text language or
  `Unknown`. These fields are read only from the source payload and its
  `run_sources` provenance; a storefront request is not described as an author
  location.
- Research coverage now lists each persisted `review_stream` with its requested
  storefront and language. It labels streams from their persisted task/source
  state as represented, visited without snapshots, not visited, stopped, or
  failed. Existing recorded gap reasons remain visible. Runs without persisted
  stream tasks say that stream details were not recorded.
- The skip-link target no longer suppresses its focus outline. Focusing the main
  content after Skip to content now has a visible accent outline.

| Command | Result |
| --- | --- |
| `bun test tests/workspace.test.tsx` | Exit 0: `21 pass`, `0 fail`, including deterministic stored multilingual provenance, requested-stream/gap, and skip-focus-style assertions. |
| `bun test tests/research.test.ts` | Exit 0: `35 pass`, `0 fail`. |
| `bun test` | Exit 0: `116 pass`, `0 fail`, `636 expect() calls` across 8 files. |
| `bun run typecheck` | Exit 0. |
| `bun run lint` | Exit 0. |
| `bun run build` | Exit 0. |
