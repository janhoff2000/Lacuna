# Research pipeline integration

`server/operations.ts` is the loader/action interface. Loaders call
`listResearch`, `readResearch`, `researchProgress`, `readSettings`, or `listSaved`.
Actions pass the original Request and a parsed, bounded payload to
`researchAction`. It rejects every non-POST or cross-origin request. The progress
resource is `/research/:runId/progress`, with no-store caching.

The action intents are `create`, `pause`, `cancel`, `resume`, `continue`,
`raise_budget`, `remove_candidate`, `add_candidate`, `settings`, `save`,
`update_saved`, and `refresh`. A create payload contains `input`, `settings`, and
optionally `budgetUsd`. Other run actions carry `runId` outside the payload.
Candidate actions use `store`/`appId` or `url`; save uses `opportunityId`; saved
edits use `id`, `status`, and `notes`. The four saved statuses are
`to_investigate`, `investigating`, `consider`, and `dismissed`.

Research input has `mode: topic|category`, `query`, `urls`, `websiteUrls`, and
`categories: [{label, apple: string|null, google: string|null}]`. Category IDs
must match the installed library. Settings extend the foundation settings with
`stores`, `languages`, `model`, `crossPlatform`, and
`direction: android_to_ios|ios_to_android|both`. The parser fills defaults and
rejects malformed store URLs or explicit inclusions above the listing cap.

Run from the repository root: `bun run migrate`, then `bun run dev` (or separate
web/worker commands). Migration paths deliberately resolve from that root so the
bundled production loader and unbundled worker use the same numbered SQL files.
Set `OPENAI_API_KEY` only in the ignored local `.env` file. Responses are requested
with `store:false`; SDK retries are disabled. Each small call and bounded repair
has a separate reservation. Missing configuration pauses the run. A missing
response or missing usage leaves the cost uncertain and prevents paid continuation.

The worker uses fixed stages, with provisional opportunity formation checkpointed
inside the grouping stage. Each collection task represents one app/locale/version.
It processes one page, checkpoints sources and cursor atomically, then yields so
the next eligible stream gets its turn. Request counters survive retries and
replacements; completed compatible trusted collections may be reused across runs.
The selected sample and every analysis are separate from raw observations.
Stream quotas are divided equally, with unavailable shares redistributed; whole
pages may be retained, but only an evenly allocated pool (at most twice the app's
initial allowance) enters sampling. Unvisited or failed streams are coverage gaps.
An ID with conflicting review content stays quarantined across all later pages,
locales, replacement segments, and reuse decisions in that run.

Discovery needs no API key: relevance comes from listing text and category-chart
provenance. Search intents preserve the supplied scope. This fallback does not
translate search terms. Review-language requests are explicit and never imply the
authors' residence. Google initially shares one anchor country per language.

Current production limitation: the existing scraper trial did not establish
review-ID stability across repeated sessions/sorts/locales. Both real adapters
therefore preserve reviews but quarantine their identities from numeric support,
selection for AI, and cross-run review reuse. They must remain untrusted until the
identity prerequisite is completed and documented for supported scopes. Fake
adapters exercise the trusted end-to-end workflow without a paid or live AI call.

Website fetching uses validated public addresses pinned to the actual HTTP
connection, same-site redirects, robots rules, bounded bytes/time, and at most
five attempted useful pages. Script-only or inaccessible sources remain Not
verified. It never invokes a browser or paid collection service. The initial
same-site rule permits only the same hostname or its www variant. Exact links
on a product-specific official page can verify a counterpart; similarity alone
is potential. Platform feasibility is not automatically researched in v1 and
remains Not verified, preventing High cross-platform confidence.
Verification citations retain their source kind, URL, and official/user
provenance. Only captured official listings/pages can verify competitor claims or
pricing; user reviews and user-added sites remain contextual evidence. Verified
product grouping never creates synthetic developer identities.

Analysis is bounded to 12 reviews per extraction and 100 findings per grouping
batch. All batch outputs persist. At most 30 batch themes, ranked by distinct
source support, enter opportunity synthesis; truncation is a coverage gap. There
are at most 15 report opportunities. Literal excerpts and source IDs are validated;
translations are labeled separately. Confidence, counts, sampling and priority
factors come from code. These results describe the analyzed sample, not population
prevalence or predicted commercial success.
Report and progress counts expose `collected`, `selected`, and `analyzed`
separately. Every opportunity's `denominator` is the number of reviews in
successfully completed analysis batches, including reviewed items with no
findings; a failed batch never enlarges that denominator.

Candidate additions reserve both a listing slot and a metadata lookup in a short
database transaction before contacting the store. Concurrent duplicate requests
share that reservation, so only one is dispatched. Undispatched cancellations
refund the lookup; dispatched failures consume it but release the listing slot.
Each reservation carries a web-process instance ID, stable across module reloads.
`recoverPendingCandidateAdditions(db)` is available to startup code and runs
before candidate add/remove/continue mutations. It atomically invalidates older
process reservations (including pre-upgrade untagged ones), releasing their
temporary slots without refunding lookup allowance. Same-process in-flight work
is untouched, and invalidated reservation IDs cannot commit late results. This
explicit restart recovery assumes the v1 single-web-process deployment; it uses
no leases, time-based expiry, or automatic retry of uncertain source requests.

Reports link immutable sources. Refresh creates another run. User notes/statuses
remain on their original saved opportunities. Budget/configuration/review pauses
leave other queued runs eligible. Worker lock/recovery behavior remains in
`docs/durable-foundation.md`.
