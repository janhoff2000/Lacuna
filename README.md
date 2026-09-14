# Lacuna

Lacuna is a local workspace for source-grounded app-market research. It collects
bounded store evidence, keeps the evidence and research state in a local SQLite
database, and presents reports with links back to the underlying sources.

It is a personal, loopback-only application: it does not create accounts, listen
beyond the local machine, or upload the SQLite database by itself.

## Install and configure

Install the exact dependency versions recorded in `bun.lock`:

```sh
bun install --frozen-lockfile
```

Create a local `.env` file only when you are ready to use AI analysis:

```sh
touch .env
# Then edit .env and add this line with your own key:
OPENAI_API_KEY=replace-with-your-own-key
```

`.env` and all `.env.*` files are ignored by Git, so the key is not part of the
project history. Do not paste a real key into a source file, screenshot, issue,
or commit. The Settings screen reports only whether a key is configured; it never
shows the key. Store collection and the automated tests do not require a key.

## Start Lacuna

First create or update the local database:

```sh
bun run migrate
```

For ordinary local work, start the web app and the worker together:

```sh
bun run dev
```

This small supervisor starts two processes: the web app (the browser interface)
and the worker (the separate process that performs queued research). Press
Ctrl-C once to stop both. You can instead run them independently when debugging:

```sh
bun run dev:web  # web app only, on 127.0.0.1
bun run worker   # worker only, against the same SQLite database
```

For a local production-style check, build and serve the app on loopback:

```sh
bun run build
bun run start    # http://127.0.0.1:3000
```

`LACUNA_DB_PATH` can point both processes at a different local database. Set it
to the identical path in each terminal, for example:

```sh
LACUNA_DB_PATH=/absolute/path/to/lacuna.sqlite bun run worker
```

## Runs, worker recovery, and limits

Create research from **New research**. If the worker is not running, Lacuna saves
the run safely and shows `Queued — worker not running`; start it with `bun run
worker`. The web app never starts a worker behind the scenes.

Only one worker may use one database at a time. The worker holds an operating-
system lock for its whole lifetime; a second worker refuses to start before it
schedules work. Do not remove the adjacent `.worker.lock` file. A stale heartbeat
means the UI can say `Worker not responding` after 20 seconds, but it is not
permission to start a replacement worker over a possibly live one.

Pause or Cancel from the run page to stop scheduling new work. Resume is always
an explicit action: after a worker crash, forced stop, or machine sleep, Lacuna
keeps committed checkpoints but marks formerly running work interrupted. Queued
runs may start when a worker is available; interrupted, manually stopped,
app-review, and budget-paused runs do not silently resume. Closing the browser
does not stop a separately running worker.

Quick and Deep are ceilings, not promised results:

| Preset | Listing ceiling | Selected-review ceiling | AI budget ceiling |
| --- | ---: | ---: | ---: |
| Quick | 10 | 2,000 | USD 1 |
| Deep | 30 | 10,000 | USD 5 |

Before every AI request, Lacuna reserves a conservative maximum from the
persisted model-price snapshot. One request may be in flight. A lost response can
still have been billed, so its reservation becomes an **unknown cost** and paid
continuation pauses; raising the run budget does not clear that uncertainty.
Inspect and reconcile the attempt before resuming. The displayed price snapshot
is an estimate, not a provider invoice.

Review IDs from the real store adapters are currently quarantined from numerical
support counts, AI selection, and cross-run reuse. This is deliberately
conservative: the required repeated-session/store/sort/locale identity study has
not yet established that those IDs remain stable. A report can therefore contain
less evidence than a preset ceiling permits, and must not be read as a
representative market statistic.

## Back up and restore the SQLite database

The default database is the ignored `data/lacuna.sqlite`. SQLite may keep recent
changes in companion `-wal` and `-shm` files, so copying only the main file while
Lacuna is running is not a dependable backup. Stop `bun run dev`, or stop both
separate processes, before restoring.

To make a consistent, self-contained backup while no process is writing, use
SQLite's backup command (it includes committed WAL data):

```sh
mkdir -p backups
sqlite3 data/lacuna.sqlite ".backup 'backups/lacuna-YYYY-MM-DD.sqlite'"
```

To restore one of those backups, keep both the web app and worker stopped, first
make a fresh safety backup, replace the main database, remove only the old WAL
sidecars, then run migrations. The sidecars belong to the database being replaced
and must not be reused with the restored file.

```sh
sqlite3 data/lacuna.sqlite ".backup 'backups/pre-restore-YYYY-MM-DD.sqlite'"
cp backups/lacuna-YYYY-MM-DD.sqlite data/lacuna.sqlite
rm -f data/lacuna.sqlite-wal data/lacuna.sqlite-shm
bun run migrate
```

Keep the original backup until you have opened the restored database successfully.
Never restore while a worker may hold the database lock.

## Commands and evidence boundaries

```sh
bun run trial      # bounded, no-AI store-scraper validation
bun run test        # deterministic unit/integration/process tests
bun run typecheck
bun run lint
bun run build
```

Verified locally by the final automated suite are migrations, checkpoints and
recovery, worker locking, budget reservations, source/SSRF guards, fixed-pipeline
behavior with deterministic adapters, UI state contracts, and the loopback
production shell. See [the final verification record](docs/plans/lacuna-v1-final-verification.md)
for exact commands and results.

The following remain unverified and must not be treated as capabilities already
proven in production: repeated real-store review-ID stability; a paid OpenAI
trial using your key and a bounded budget; a complete live research run; platform
feasibility research; and scraper/provider coverage, pagination, rate, or yield
limits beyond the small documented trial. No live OpenAI request is made by the
test suite.

For implementation detail and the earlier limited scraper observations, see
[durable foundation notes](docs/durable-foundation.md),
[the research pipeline](docs/research-pipeline.md), and
[the scraper trial guide](docs/scraper-trial.md).
