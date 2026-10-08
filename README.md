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

Real store review IDs are treated as stable for numerical support counts, AI
selection, and cross-run reuse. This is an explicit product assumption, based on
two immediate bounded samples that returned the same 840 IDs and unchanged review
payloads; it is not a guarantee from Apple or Google. If a later page, locale, or
replacement returns conflicting content for the same ID, Lacuna quarantines that
ID from counts, analysis, and reuse for that run. Reports remain purposive samples,
not representative market statistics.

## Market transfer

**Market transfer** looks for apps that are listed in one storefront (by default
the United States) and not in another (by default Germany). It is a listing
survey and collects no reviews. It reads the free, paid and grossing charts of
each chosen category (up to 200 listings per chart and store), looks each app up
by its store ID in the target storefront, and fetches source-market details only
for listings that are missing there. The model then sets aside apps tied to a
source-market institution (a specific bank, retailer, carrier, and so on). For
the most-rated leads, up to the reviewed-app maximum, Lacuna searches the target
store, in the target language, for a regional variant or a local alternative;
the remaining leads are listed as not searched.

**Market transfer listings** under Advanced sets how many apps are surveyed:
2,000 for Quick, 10,000 for Deep, and up to 25,000. With every category selected
the charts hold roughly 12,600 rows per store before duplicates, so the largest
sizes need both stores. App Store checks and details are requested 100 apps at a
time. Google Play has no such request, so every Play app costs one request, or
two if it is missing; a large Play survey takes a long time and may be rate
limited. After repeated failures Lacuna stops asking that store and reports the
rest as unchecked.

The survey is kept in its own table, not in the run checkpoint. Definitive
storefront answers and screening verdicts are also remembered in the app catalog
and reused by later surveys: "available" answers and listing pages for 30 days,
"not found" answers for 7 days.

Availability has three outcomes. Only an explicit "not found" answer from the
store counts as missing; a timeout, rate limit, or any other failure is recorded
as unknown and never becomes a lead. This rests on assumptions that the
automated tests do not verify against the live stores:

- An Apple lookup by ID that returns no result for a country means the app is
  not listed in that storefront.
- A Google Play listing page can be visible for a country where the app cannot
  be installed, so Google Play gaps may be missed.
- A local edition published under a different app ID, or a competitor that is
  not a store app, is only found if the bounded target-market search surfaces it.

A transfer lead is a prompt to investigate. It is not evidence of demand, market
size, or regulatory feasibility in the target market.

## Business ideas

**Business ideas** covers businesses that are not store apps. Lacuna does not
search the web itself. It writes a research prompt from the two markets and an
optional focus; you run that prompt in a deep-research tool you already use
(Claude, ChatGPT) and paste the complete answer back. The answer must end with
the json block the prompt asks for. A second, optional prompt asks the same tool
whether each idea, or a local equivalent, already exists in the target market.

From the pasted answer Lacuna keeps only names and URLs as starting points. It
fetches each listed page through the same public-address and robots.txt checks
as other websites (two pages from a company's own site, one from any other
source), and the model describes each business from those pages alone. Every
description carries quotes that must appear literally on a fetched page; a
profile that fails that check is discarded and the idea is shown with its pasted
summary, labelled as an unverified claim. Reported local equivalents are fetched
and screened the same way.

Boundaries:

- Which ideas exist, and what the target market contains, comes from research
  outside Lacuna. "No local equivalent reported" means the pasted answer named
  none, not that none exists.
- Pasted URLs are fetched from your machine. Paste answers only from research
  you ran yourself.
- Reading the sources uses AI analysis and counts toward the run's AI ceiling.
- Ideas are listed in the report and cannot yet be saved as opportunities.

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
