# Lacuna v1 implementation blueprint

Status: ready for implementation. Implement in a fresh context using this blueprint and the project DESIGN.md.

Project root: `/Users/jan/Repositories/Lacuna`. Design specification: `/Users/jan/Repositories/Lacuna/DESIGN.md`. The repository copy of this plan is `docs/plans/lacuna-v1.md`; the handoff copy is `~/.Codex/plans/lacuna-v1.md`.

## Objective

Build a personal, local research application that discovers app-market opportunities from review evidence and competitor comparisons. Support topic/need research and category-based broad discovery. User input defines scope; do not exclude crowded categories or force already narrow requests into smaller niches.

## Fixed choices

- TypeScript; React Router Framework Mode for interface and backend; Bun runtime and package manager; SQLite through `bun:sqlite`; shadcn/ui.
- Separate Bun background-worker process in this repository. Interface and worker share a local SQLite database.
- Personal workspace, initially local only; no registration, billing, hosted deployment, or multi-user access.
- Free collection through `app-store-scraper` and `google-play-scraper`; no paid collection integration in v1.
- OpenAI API directly; configurable models. Validate current supported APIs and model identifiers before implementation. Do not hard-code speculative model names or prices.
- Both light and dark themes, following system appearance initially; manual override. See DESIGN.md.
- Preserve existing project MCP configuration and unrelated files. Migrate existing package.json dependencies (including shadcn) and npm lock state to Bun during setup; verify installation, then remove package-lock.json. Commit bun.lock as the sole lockfile and use Bun scripts/frozen installs thereafter. Rebuild node_modules only if required by installation problems; it is generated state, not a second package-manager configuration.

## KISS architecture rules

- Build one application in one repository, with two entry points: React Router web and a Bun worker. Share ordinary TypeScript functions and one SQLite file.
- Use React Router loaders/actions for reads and mutations, local React state for transient UI, and one progress resource endpoint for polling. No additional REST framework, GraphQL, client data-fetching framework, or global state store unless a demonstrated requirement cannot be met directly.
- Start with one active run and one external request at a time. Keep the UI responsive through the separate worker. Add bounded parallel collection only after measurements justify it; do not build concurrency infrastructure in advance.
- Use a fixed sequence of research stages and a small switch over task kinds. No generic workflow engine, task dependency graph, event bus, plugin registry, dependency-injection container, or provider framework.
- Use prepared SQL statements and numbered SQL migration files through bun:sqlite. No ORM or repository/service/controller layering around simple database calls.
- Wrap each scraper in a small module and OpenAI in one request function. Keep source-specific quirks there. Replaceability means changing a module, not implementing hypothetical providers.
- Keep selection/sampling/confidence rules in plain functions with a single policy version. Internal thresholds are code constants, not a configurable rules engine or new settings screens.
- Keep checkpointing, source snapshots, duplicate prevention, request accounting, and singleton enforcement: these directly support agreed product requirements.
- Build only the modules and tables listed below initially. Add an abstraction only when a real second use or measured problem warrants it.

## Research entry points and scope

- Topic/need: free-text research input; optional store URLs to include specific apps.
- Broad discovery: one or multiple store categories, with optional audience/need guidance.
- Generate scoped subtopic searches, combine category charts, search results, and related apps, then select a varied relevant sample. Charts are one input, not the sole selection mechanism.
- Honor broad, established-niche, and precise-need inputs. Explain each selected app's relevance.
- Automatic execution by default; optional `Review apps first` pauses after app selection. Allow removing candidates and adding store URLs before continuation.
- Geographic presets: International, US, Europe, custom countries. Expand presets to explicit country lists visible/editable before launch.
- Initial proposed preset membership: International = US, UK, Germany, France, Netherlands, Spain; Europe = the same European subset including UK. These are configurable starting defaults, not exhaustive continental coverage; validate collection coverage and expose the exact membership.
- Accept multilingual evidence; do not discard reviews because they are not English. Generate English reports, preserve source text, and provide labeled translations.
- Google Play collection explicitly iterates language settings. Start with relevant languages for selected markets, plus English; expose collection coverage and support additional languages. Do not imply that all languages or all reviews were collected.
- Record requested country and language separately from detected text language. A requested storefront is not proof of a review author's residence.

## Opportunity perspectives

Include missing capabilities, underserved audiences, and poor execution (reliability, complexity, pricing, advertising, etc.).

Add an independently toggleable `Cross-platform opportunities` perspective:

- Directions: Android → iOS, iOS → Android, both.
- Default enabled with Android → iOS selected.
- Positive reviews can establish reasons to investigate a successful concept; complaints are not required for this perspective.
- Search for both the same product and alternative products serving the need on the destination store. Same-product absence alone is not a market gap.
- Check platform-specific feasibility using authoritative documentation when needed; mark unverified constraints explicitly.
- Label direction per opportunity. Say `No suitable alternative found in this research` rather than asserting universal absence.

## Research presets and costs

| Preset | Maximum app listings | Maximum unique written reviews selected | Default AI ceiling |
| --- | ---: | ---: | ---: |
| Quick scan (default) | 10 | 2,000 | USD 1 |
| Deep research | 30 | 10,000 | USD 5 |

- Limits are adjustable ceilings, not guaranteed collection quantities or estimated prices.
- The 2,000/10,000 defaults remain provisional until the free collection trial measures actual yield. Never fetch unrelated apps or widen user scope just to fill a cap. Report actual collected/selected/analyzed counts; sparse runs may finish far below their limits.
- iOS and Android listings count separately toward collection limits. Link verified counterparts for competitor comparison; do not merge based on title alone.
- Distribute review allowances across apps, countries, and languages; prevent a large app from consuming the entire allowance.
- Prefer recent evidence, retaining rating diversity and positive evidence. If extra complaint-focused sampling is used, label its selection method separately; do not interpret it as a representative prevalence estimate.
- Enforce a per-run budget before every AI request, including retries, by reserving a conservative maximum for input and permitted output. Track estimates separately from provider-reported usage and actual recorded charges.
- Permit only one in-flight AI request. Persist model pricing and pricing timestamp used for estimates. If pricing or usage cannot be established, flag uncertainty and pause paid continuation rather than claim a guaranteed ceiling.
- A lost response may already have been billed. Preserve the reservation/unknown-cost state; do not silently refund it when retrying.
- Pause on insufficient budget and allow raising the limit and resuming.

## Selection and sampling policy v1

These are explicit, versioned starting heuristics, not empirically proven thresholds. Record the policy version and effective settings in each run; tune them from trial evidence without silently changing old reports.

### Candidate selection

- Honor user-supplied/included listings first, within the listing cap; ask for adjustment if explicit inclusions exceed it.
- Generate at most 6 scoped search intents for Quick and 12 for Deep. Include the original need, distinct audiences/tasks when the scope permits, and destination-store alternatives for enabled cross-platform research. Localized translations are variants of the same intent, not extra diversity slots.
- Collect at most 10 search results per intent/store/country and 20 chart results per selected category/store/country. Fetch at most 5 related listings for each of the first 5 relevant seeds. Bound unique candidate metadata lookups to 100 Quick / 300 Deep; apply deterministic round-robin across intents, stores, and countries before truncating.
- Deduplicate candidates by store + app ID; preserve all discovery origins. Judge relevance from captured listing content using structured direct / adjacent / unrelated labels and a source-grounded reason. Persist that assessment; exclude unrelated candidates.
- Fill remaining slots round-robin across intents and enabled stores, direct before adjacent; within each bucket prefer listings covering an as-yet-unrepresented developer. Break ties by source rank then store/app ID. Chart rank is a tie-break, not evidence of opportunity.
- Soft cap one developer at 25% of selected slots (rounded up), except explicit inclusions; relax only when relevant alternatives are exhausted and disclose it. Do not impose an arbitrary minimum rating count or exclude well-rated apps.
- Unused slots stay unused when scope yields no relevant candidates. Counterpart/alternative metadata may be inspected within the discovery lookup allowance; collecting additional reviews requires a listing slot. Disclose when those limits prevent verification.

### Review allocation, language overlap, and recency

- With R review slots and N selected listings, initially allocate floor(R/N) per listing, distributing the remainder in stable selection order. Redistribute unused quotas equally among non-exhausted listings, up to twice their original quota; any remaining slots stay unused. Do not allocate proportionally to rating totals.
- If N is zero, complete with an actionable no-matching-apps result. Divide each listing's selected-review allowance equally across its nonempty streams, redistributing unavailable shares equally. Assign overlapping IDs once in deterministic stream order, preserving every locale provenance; never consume two stream quotas for one review.
- Within each listing, cycle equally through eligible collection streams, one page at a time. Apple streams use selected storefronts; Google streams use distinct relevant languages with one selected-country anchor per language initially. Reuse language streams across countries unless the overlap trial demonstrates additional country-specific yield. Persist the exact requests; do not infer geographical populations from Google locale settings.
- Deduplicate before consuming allocation. Locale iteration aims to expand unique evidence and language diversity, never to multiply an assumed country review count. Record overlap as duplicate IDs / returned IDs, plus incremental unique yield per locale.
- Use newest-first retrieval. Initially collect a bounded candidate pool of at most twice the assigned review quota per listing (unique reviews), then select up to its quota for AI analysis. Whole-page overfetch may be persisted, but unselected reviews do not count toward analyzed evidence.
- Safety bound: at most 100 review page requests Quick / 400 Deep, 10 pages per Apple stream unless verified otherwise, and 3 attempts per request. Stop a stream after two consecutive pages with no new IDs, repeated cursor, exhaustion, or access failure. Retries count toward request bounds; normal resumption retains counters.
- Within each stream's allowance, select floor(80% of its slots) from the newest available reviews regardless of rating. Use the remaining slots to improve representation of 1–2, 3, and 4–5 star groups, cycling least-represented group first using newest remaining reviews (ties: lower star group, then review ID). If a group is absent, fill from newest remaining evidence; don't promise balanced ratings.
- Prefer the last 12 months; use older evidence only when the bounded pool lacks sufficient recent evidence, label it historical, and disclose date coverage. Missing-date evidence is marked undated and cannot establish recency.
- Keep the recency-first and diversity-supplement samples labeled. This is purposive sampling, not a random market survey; report complaint counts within the analyzed sample only.

### Counterpart verification

- A verified same-product pair requires an official product page linking both exact store IDs, or an explicit first-party statement linking the product to the destination listing. Capture that source.
- Matching title, icon, developer name, or developer domain only suggests a counterpart; it does not verify one. Related products from the same company remain distinct unless first-party evidence establishes the relationship.
- Keep potential, verified, and not-found states; unverified matches cannot merge product identities. Search same-product names/developer first, then need-based alternatives separately. Record queries, candidates checked, and unavailable markets.
- App-count and developer-count evidence remain separate, so a verified product on two stores does not falsely represent two independent competitors.

### Evidence confidence

- Compute confidence from a versioned rubric in code; AI supplies source-backed classifications, not an unexplained confidence label. Show underlying counts/checks alongside the label.
- High: at least 10 distinct supporting review IDs across at least 2 independent products/developers, at least half of support dated within 12 months, relevant competitor/alternative checks completed, and no unresolved material contradiction, identity uncertainty, or missing-source dependency in the main claim.
- Medium: at least 3 distinct supporting reviews with some support within 12 months and valid citations, but one or more High requirements unmet. A material unresolved contradiction caps confidence at Low.
- Low: all remaining cases, including historical-only/undated support or uncertain identity. Provisional opportunities cannot be High before checks finish.
- Cross-platform exception: one source product may qualify for High with at least 10 supporting reviews and the same recency threshold, plus completed same-product and need-based searches on the destination store and no unresolved feasibility/identity issue. Confidence concerns the observed evidence within the search scope, not predicted commercial success or proof of platform-wide absence.
- Counts refer to distinct source reviews, not guaranteed distinct people; translated duplicates count once. Missing reviews, checks, or contradictory evidence must be disclosed.

## Analysis pipeline

1. Discover candidate apps from the supplied scope; deduplicate and explain selection.
2. Optionally wait for candidate review.
3. Collect listing details and paginated reviews; persist each completed page and next cursor together.
4. Analyze small batches of reviews into structured findings with source IDs, exact source excerpts, needs, audience when evidenced, impact, sentiment, dates, and uncertainty.
5. Group related findings across apps and languages, preserving links to individual evidence. An audience inferred by AI must be labeled as inferred.
6. Form provisional opportunities across the enabled perspectives.
7. Check store descriptions and bounded official websites for relevant capabilities and prices. Revisit or discard provisional opportunities when contradicted.
8. Assemble report opportunities with priority, confidence, evidence, counterevidence, and coverage limitations.

- Use typed, validated AI output and bounded repair/retry behavior. Keep model, prompt version, input hash, and usage records for each analysis.
- Compute review/app counts from stored unique IDs in code. Validate exact quotes against captured source text; translations are separate fields, not original quotations.
- Treat fetched reviews and pages as untrusted data, never agent instructions. Do not allow source text to authorize tools, change budgets, or disclose secrets.
- Prioritize High / Medium / Low based on recurrence, impact, competitor coverage, and recency; explain the factors. Keep evidence confidence separate and make unknowns explicit.
- No invented market size, revenue, willingness to pay, or download estimates. Keep numeric rating totals distinct from written-review counts.
- Report complaint frequency only within the analyzed sample and show its denominator; do not extrapolate to the whole user base.
- Show apps and emerging themes progressively. Clearly mark provisional opportunities `Preliminary`; checkpoint their state and retain a clear distinction from completed/partially verified results.
- A finished run with source failures is `Completed with gaps`; inaccessible evidence does not become a successful competitor check.

## Competitor website collection

- Begin from the official website in the store listing; support user-added URLs.
- Fetch a bounded set of relevant same-site pages, such as features, pricing, help, and FAQ. Suggested initial limit: 5 pages per competitor, with maximum response bytes and timeouts; expose any resulting coverage gaps.
- Prefer ordinary HTML fetching and readable-text extraction. Do not add a paid search service, proxy service, or unrestricted autonomous browser in v1.
- Permit public HTTP(S) destinations only. Validate destinations and redirects; block localhost, private/link-local networks and non-HTTP protocols. This includes links discovered in third-party content.
- Follow applicable site access rules; back off on access denial or throttling. A failed or script-only page becomes `Not verified` with source URL and reason.
- Capture retrieved text, URL, retrieval time, and content hash. Store source-supported pricing with currency, billing interval, and qualifications; do not infer entitlement from price alone.
- Distinguish advertised support, user-reported shortcomings, and unknown capabilities.

## Durable worker and recovery

Reason: SQLite-backed tasks fit local execution and preserve progress without a separate queue service.

- One active research run at a time; additional eligible runs form a persisted queue. Runs awaiting app review, manual resume, or budget do not block others.
- Execute tasks and external requests sequentially in v1. Keep network/AI operations outside database transactions.
- Use SQLite foreign keys, WAL mode, a busy timeout, short transactions, and migrations. Verify those settings under the installed Bun version.
- Persist a task row per collection stream, analysis batch, or competitor check, with stage, status, attempt count, next retry time, checkpoint JSON, and current attempt ID. The fixed stage runner creates tasks and advances after required tasks finish; no dependency table or graph.
- Enforce exactly one worker process per database with a tested process-lifetime exclusive local lock, automatically released on process exit. Prefer an OS-backed advisory lock held for the worker lifetime; prove Bun/macOS support in the foundation trial. Refuse a second worker before it schedules any work. Do not use an expiring SQLite row as the only lock or steal a lock based on elapsed time.
- No distributed/task leases or multi-worker takeover protocol in v1. Claim tasks atomically within the single worker and retain attempt IDs to reject late responses from cancelled/superseded attempts.
- Commit task results and completion atomically. Enforce unique keys so repeated collection/analysis steps do not duplicate stored results.
- Collect page by page, detect repeated cursors/pages, stop at exhaustion or limits, and persist progress. If a cursor expires, restart the affected segment with deduplication.
- Store run status as queued, running, paused, completed, or cancelled. A separate reason identifies app review, user pause, budget, interruption, or error; a coverage flag produces Completed with gaps. Keep transition logic in one function. Cancel preserves results and permits explicit resume.
- Temporary network/rate-limit failures: exponential backoff with jitter and a bounded attempt count; honor retry timing from providers. Authentication/invalid configuration errors require attention rather than repeated requests.
- Pause/cancel stops scheduling new tasks and aborts requests when supported. Safely save already completed responses without advancing the run; in-flight billing can still occur.
- On worker restart, mark formerly active work interrupted and require explicit Resume for affected runs. Preserve queued work; queued runs may execute when the worker is started, but interrupted/manual-stop runs must not auto-resume.
- Resuming reruns only unfinished/failed eligible tasks, retaining successful checkpoints and charged/uncertain AI attempts.
- Browser closure does not stop a separately running worker. Mac sleep may suspend activity; expired requests recover through the same retry/checkpoint mechanism. Document this distinction in the UI/help.
- Recover from application/process/network interruption to the last committed checkpoint. Do not promise recovery from disk loss/corruption or continuation in the middle of an external request.
- Derive progress from current run/task rows; the UI polls one backend endpoint while work is active and revalidates on focus. No event log, event replay, WebSocket, or separate real-time service.

### Worker startup and availability

- `bun run dev` starts the web process and worker through a small local supervisor; `bun run dev:web` and `bun run worker` allow explicit separate startup. Ctrl-C stops both supervised children gracefully, with forced-exit recovery still covered. Starting the worker is an explicit action and may process eligible queued runs.
- The web backend never silently spawns workers from requests. Start research persists a queued run even if the worker is unavailable; show `Queued — worker not running` with the exact startup command rather than implying work began.
- Publish a worker status record every 5 seconds and on clean exit; after 20 seconds without a status update show `Worker not responding`. A stale status is advisory only and never authorizes starting a replacement over a live exclusive lock.
- Queued runs explain that they start when a worker is running. Restarted interrupted runs still require manual Resume. Distinguish missing worker, nonresponsive worker, and normal paused/waiting runs.

## Data model

Use these initial tables; validate review identity before finalizing source keys. Use JSON for small payloads loaded as a whole, and SQL columns for IDs, state, timestamps, uniqueness, filtering, and accounting. Validate JSON when reading/writing; do not build a generic document database.

| Table | Responsibility |
| --- | --- |
| `settings` | One non-secret settings JSON record. No API-key field. Worker availability can use a separate named record here; it is not the worker lock. |
| `runs` | Input/settings snapshot, status/reason, limits, budget, timestamps, coverage summary. |
| `tasks` | Fixed stage/kind, run ID, state, retry fields, attempt ID, checkpoint/result JSON. Collection checkpoints hold cursors and collection-version metadata. |
| `sources` | Immutable listing, review, or website snapshots; source kind, store/app/review IDs as applicable, locale, URL, content hash, payload and retrieval time. Unique source identity + content hash + locale where content is localized. |
| `run_sources` | Run-to-source references, selected-for-analysis flag, collection task/version and locale provenance. Enforce one counted logical review per run even when multiple locales return it; links to other observations do not inflate counts. |
| `analyses` | Reusable extraction/grouping output, exact source IDs, input hash, model, prompt/schema versions. One JSON output per batch/stage result. |
| `ai_requests` | One row per paid attempt, reservation, known/unknown usage and charge, request ID, error. Retain this accounting separately from task retries. |
| `opportunities` | Run ID, title, priority/confidence and structured report JSON, including source IDs and counterpart verification. |
| `saved_opportunities` | Originating opportunity ID, user status, notes, timestamps. |

Do not create separate app, review-version, document, task-attempt, event, counterpart, or opportunity-evidence tables in v1. Immutable source rows replace separate version tables; report JSON contains evidence links; tasks contain progress and collection metadata. Extract a new table only when actual queries require it.

Preserve reports by linking immutable source rows. Reuse analysis only for exactly matching inputs and model/prompt/schema versions. Starting freshness: listing snapshots 24 hours, completed review collections 24 hours, official pages 7 days. Keep these constants in one policy module. Refresh research creates a new run, never rewriting old reports or notes.

### Review identity prerequisite

- Before finalizing review keys or trusting reuse/counts, test repeated fetches of overlapping reviews in the same locale, different locales and sorts, and a later session. Record missing IDs, ID changes, collisions, content changes under the same ID, and cross-locale overlap; absence of overlap makes a test inconclusive, not successful.
- Use (store, app ID, source review ID) as the logical key only after this check passes. Keep immutable content versions under that identity. Locale belongs to provenance, not an extra identity component.
- Retain raw source identifiers and a diagnostic content fingerprint. Never substitute text-only hashes or display names as proof of identity: distinct reviews may share text, and edited reviews may change it.
- Missing/unstable IDs are quarantined from numeric support counts and cross-run reuse; flag coverage and fix the adapter or narrow its supported cases before enabling trusted analysis. A limited trial does not guarantee future provider stability; keep anomaly detection and conservative failure behavior.

### Partial freshness and collection versions

- A collection segment is one review-collection task for an app + requested locale + sort + collector/policy version. Store its collection version, start/end times, achieved coverage, stop reason, and next cursor in task checkpoint JSON. Commit new source references and cursor together after each page; no separate segment/page tables.
- Reuse a segment only if completed to the required quota/exhaustion, compatible with requested scope, and started within the freshness window. If a new run needs more reviews than the cached coverage, start a new collection task from page one; avoid cross-run cursor extension. Reuse unchanged stored source content and analysis, but never call partial coverage complete.
- Within the same unfinished run, resume a fresh compatible task at its saved cursor. If stale or cursor-invalid, create a replacement task starting at page one and retain the earlier task/source references with their timestamps. Successful analysis of unchanged sources remains reusable.
- Keep observation times on the collecting task/run-source link even when unchanged content reuses an older immutable source row. Use the successful observation time for freshness and the source's original capture time for provenance.
- Do not stitch fresh page one to stale page two as a supposedly fresh collection: review rankings/page offsets can move. Restart the affected segment; unaffected fresh segments may be reused, with each segment's retrieval interval visible.
- Failed refreshes retain older captured evidence, explicitly marked stale with its date and failure reason; never silently label it refreshed. Preserve the old report. Source snapshots reflect retrieval intervals, not an atomic snapshot of the external store.

## Interface

Main navigation: Research, Saved opportunities, Settings.

### Research

- List current, queued, interrupted, and prior runs with truthful states and primary next action.
- New research form: mode/input/categories, scope with explicit countries, depth, app/review limits, AI ceiling, review-apps toggle, cross-platform toggle and direction.
- Candidate review: include/remove apps, add store URL, show reason/source for selection, continue.
- Run view: stage, collected/analyzed counts, spending estimate vs ceiling, errors/coverage, pause/cancel/resume controls, progressive results.
- Split report view: opportunity list and spacious detail pane; tabs/sections for evidence, competitor comparisons, and apps/coverage.
- Opportunity details: need, audience, perspective/direction, priority reasons, confidence, supporting and conflicting sources, translations, dates, verification status, save action.
- Selecting a claim exposes its actual supporting passages. Preserve source provenance and accessible navigation back to the source list.
- Never manufacture direct review permalinks if the source lacks them; show the best valid app/source URL plus stored review identifier and date.

### Saved opportunities

- Save across runs, filter by user status, edit notes, reopen source report.
- Statuses: To investigate (default), Investigating, Consider, Dismissed.
- These are user workflow states, not AI priority or run states.
- Refreshing a run must not overwrite notes or move statuses. Do not auto-merge similar saved opportunities without a deterministic identity or user action.

### Settings

- Model selection, user-facing research defaults/limits, appearance, and API configuration status. Keep internal freshness/sampling thresholds in policy.ts rather than exposing every implementation constant as a setting.
- Load `OPENAI_API_KEY` from a local ignored environment file; display configured/missing status and setup instructions, never the secret. Keep secret handling server/worker-only.
- Follow system light/dark by default and persist explicit theme choice.

### Layout and product states

- Follow DESIGN.md. Responsive layout collapses panes on smaller screens while retaining evidence navigation.
- Provide actionable empty/error/partial states, keyboard focus, accessible controls, and reduced-motion support.
- Explain missing configuration, budget pauses, retry exhaustion, app-review waits, and interrupted work with the relevant next action.
- Include a development-only component/state reference route; no public component-library project is needed.

## Suggested repository structure

```text
app/
  routes/              # pages, loader/action functions, progress endpoint
  components/ui/       # shadcn primitives
  components/          # only reused Lacuna UI
  styles/
server/
  db.ts                # connection and prepared queries; split if it grows
  migrations/          # numbered SQL files
  runs.ts              # run transitions and queue operations
  pipeline.ts          # fixed stage runner
  policy.ts            # selection, sampling, confidence constants/functions
  sources.ts           # source identity, snapshots and freshness
  collectors/apple.ts
  collectors/google.ts
  collectors/web.ts
  ai.ts                # OpenAI request wrapper and budget accounting
  prompts.ts           # versioned prompts and output schemas
worker/index.ts        # singleton, work loop, availability, shutdown
shared/types.ts        # browser-safe domain types
scripts/dev.ts         # start/stop web and worker; no process-manager service
tests/
docs/plans/lacuna-v1.md
DESIGN.md
data/                  # ignored SQLite database and sidecar files
```


- Keep server-only code out of browser bundles; confirm React Router boundary conventions during setup.
- Provide Bun scripts for web, worker, combined local development, migration, typechecking, linting, tests, and production build/local start.
- Bind the personal app to loopback by default; no LAN/public exposure. Apply same-origin protection to mutations and do not provide destructive actions via GET.
- Ignore secrets, database files, logs, build output, and dependencies. Do not log API keys or full sensitive configuration.
- README must cover setup, OpenAI key configuration, startup of both processes, migrations, stopping/resuming, limits, and consistent database backup/restore.

## Implementation milestones and acceptance checks

### 1. Validate free collection and identity

- Read applicable repository instructions and preserve existing work.
- Install/test the two selected scrapers in a bounded trial under Bun before building their integration contracts around assumptions. Record exact versions.
- Test discovery, details, and multiple review pages on at least three apps per store spanning smaller and popular apps; include US and multiple European storefront/language combinations.
- Verify stable review IDs, timestamps, rating totals vs written reviews, language behavior, duplicates, pagination and empty/error behavior. Document actual caps; Apple library currently documents a 10-page limit, which must be verified.
- Gate final review identity/schema decisions on the identity checks above. Measure cross-locale incremental yield and overlap before finalizing streams, allocation defaults, or review caps; document sparse and high-volume cases separately. Trials in this milestone make no paid AI calls.
- Capture only bounded samples and keep raw trial evidence out of git where unnecessary. If a selected library fails, investigate/fix the adapter and report the limitation; do not silently introduce paid collection.

### 2. Foundation and recovery first

- Scaffold React Router with Bun, configure shadcn/theme, set up migrations and SQLite access.
- Implement the sequential stage runner, task checkpoints, run transitions, reservations, and queue eligibility before connecting paid AI work.
- Verify restart recovery and duplicate prevention using deterministic fake collectors/AI adapters.
- Verify singleton lock release on process kill, refusal of a second worker, explicit startup, and missing/nonresponsive-worker UI behavior. Complete reservation accounting tests before any paid model trial.

### 2b. Paid model trial after budget enforcement

- Select supported OpenAI extraction/synthesis models using a small multilingual sample with manually checked expectations and source citations. Keep model configuration adjustable.
- Route every trial request through the tested reservation/accounting layer with a USD 1 total trial budget and bounded output; include retries and uncertain billed attempts. No direct bypass scripts. Require the user's configured API key; record usage and disclose any unavailable live validation.

### 3. Research pipeline

- Implement both entry modes, source adapters, candidate review, multilingual sampling, extraction/grouping, cross-platform checks, bounded websites, report snapshots, cache reuse, and budget pauses.
- Verify source-grounded reports before expanding UI polish.

### 4. Workspace

- Implement all main views, progressive states, evidence detail, saved statuses/notes, settings, and development component reference.
- Render and inspect realistic data in light/dark themes and narrow/wide layouts. Use clearly labeled fixtures where needed, never fake live success.

### 5. Verification and documentation

- Typecheck, lint, build, and targeted tests.
- Exercise process termination before/after commits, cancellation with an in-flight request, resume after retry exhaustion, repeated page/cursor responses, and expired cursors.
- Test second-worker refusal, lock release on termination, late responses from cancelled attempts, database contention, task deduplication, and sequential budget reservations, duplicate dispatch prevention, and unknown billed attempts.
- Test equal-share allocation/redistribution, candidate diversity/tie-breaks, missing rating groups, overlap/no-new-ID stopping, counterpart ambiguity, and confidence boundaries. Test partial/stale collections without mixing page generations and incomplete refresh reporting.
- Verify run snapshots remain unchanged after source refresh, notes survive refresh, source excerpts match, translations are labeled, and cross-platform absence isn't inferred solely from name matching.
- Check mixed languages, low/no review volume, unavailable countries/apps, blocked websites, prompt-injection text, invalid AI output, and missing API credentials.
- Confirm paused/app-review/budget runs don't block eligible queued runs and manual stop states don't auto-resume.
- Complete an end-to-end live research run if credentials and access permit; explicitly report any unverified integration.
- Document actual scraper limits and measured model costs. Do not promise full-store coverage or representative market statistics.

## Reference sources for implementation validation

- https://github.com/facundoolano/app-store-scraper
- https://github.com/facundoolano/google-play-scraper
- User-supplied ElevenLabs, Resend, and Linear style references were adapted into project DESIGN.md; they are inspiration, not authoritative product specifications.

## Out of scope

Public hosting/accounts/billing; paid data providers; scheduled automatic refresh; exhaustive store crawling; guaranteed demand/revenue predictions; automatic app publication; separate queue infrastructure; building a marketing site instead of the research workspace.
