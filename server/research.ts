import { randomUUID } from "node:crypto";
import { decodeObject, encodeJson, languageMatchesAny, normalizeLanguageTag, type JsonObject, type Store } from "../shared/types";
import { transaction, type DB } from "./db";
import { analyze, AiPaused, type AiTransport } from "./ai";
import { appleAdapter } from "./collectors/apple";
import { googleAdapter } from "./collectors/google";
import { CHART_COLLECTIONS, COLLECTOR_VERSION, collectionFailure, hash, listingMissing, parseStoreUrl, planLocales, type Listing, type Locale, type StoreAdapter, type WrittenReview } from "./collectors/common";
import { collectWebsite, type WebPage, type WebResult } from "./collectors/web";
import type { PastedIdea, Presence } from "../shared/ideas";
import { knownScreening, recordAvailability, recordListing, recordScreening, recordSummary } from "./catalog";
import { collectionRequestCount, parseCollectionCheckpoint, replaceCollectionTask } from "./collections";
import { allocateReviews, collectionReuse, equalShares, evidenceConfidence, FRESHNESS, LIMITS, metadataCandidates, pageStop, POLICY_VERSION, PRESETS, sampleReviews, selectCandidates, type Candidate } from "./policy";
import { broadDiscovery, researchInputSchema, researchSettings, searchIntents } from "./research-input";
import { assertAttempt, checkpointTask, getRun, markCoverage, type RunRow, type TaskRow } from "./runs";
import { disqualifyReview, reviewDisqualified, saveSource, type SourceSnapshot } from "./sources";
import { findingSchema, PROMPT_VERSION, schemas, themeSchema, transferVerdict, validateCitations, validateStageLinks, type Finding, type ProposedOpportunity, type QuoteSource, type TransferVerdict } from "./prompts";
import type { Handlers, StagePlanner } from "./pipeline";

const json = (value: unknown): JsonObject => decodeObject(encodeJson(value));
export interface CandidateRecord extends Candidate { sourceId: string; title: string; language: string; removed?: boolean; cohortFit?: "core" | "adjacent" | "unrelated"; coreFunctionality?: string; targetAvailability?: TargetAvailability; transferFit?: "transferable" | "market_specific" | "unclear"; targetSearchTerms?: string[]; barriers?: string[]; targetCheckedAt?: number }
export type TargetAvailability = "available" | "unavailable" | "unknown";
interface Seed extends Locale { store: Store; appId: string; rank: number; intent: string; origins: string[]; included: boolean; targetAvailability?: TargetAvailability; targetCheckedAt?: number }
interface DiscoveryState { seeds: Seed[]; candidates: CandidateRecord[]; selected: CandidateRecord[]; completed: string[]; lookups: number; developerCapRelaxed: boolean; exploration?: JsonObject; transfer?: JsonObject; ideas?: IdeaRecord[]; additions?: { key: string; reservationId: string; processInstanceId?: string }[]; requests?: { key: string; store: Store; country: string; language: string; intent: string; ids: string[]; request: JsonObject }[] }
// "pending" until its pasted sources were fetched and "fetched" until profiling settled, so a run paused
// mid-profile resumes that idea. A profile exists only when its literal citations validated.
export interface IdeaRecord extends PastedIdea { pages: { url: string; official: boolean; sourceId: string }[]; failures: { url: string; reason: string }[]; profile: JsonObject | null; status: "pending" | "fetched" | "profiled" | "no_sources" | "not_profiled" | "failed" }
export interface IdeaMarket {
  id: string; presence: Presence | null; note: string; urls: string[];
  equivalents: { name: string; url: string | null; note: string; sourceId: string | null; fit: "core" | "adjacent" | "unrelated" | null; reason: string }[];
  verdict: "none_reported" | "equivalent_unconfirmed" | "not_researched" | "reported_present" | "equivalent_confirmed";
}
export interface SourceRow { id: string; store: Store | null; app_id: string | null; review_id: string | null; kind: string; url: string; payload_json: string; captured_at: number; logical_review_key?: string | null; provenance_json?: string; task_id?: string }
export interface ResearchDependencies { apple?: StoreAdapter; google?: StoreAdapter; website?: typeof collectWebsite; aiTransport?: AiTransport; aiConfigured?: boolean; now?: () => number }

export function runTasks(db: DB, runId: string): TaskRow[] { return db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE run_id=? ORDER BY created_at,id").all(runId); }
export function sourcesForRun(db: DB, runId: string, kind?: string, selected = false): SourceRow[] {
  return db.query<SourceRow, [string,string|null,string|null,number]>("SELECT s.*,rs.logical_review_key,rs.provenance_json,rs.task_id,MAX(rs.observed_at) AS observed_at FROM sources s JOIN run_sources rs ON rs.source_id=s.id WHERE rs.run_id=? AND (? IS NULL OR s.kind=?) AND (?=0 OR rs.selected=1) GROUP BY s.id ORDER BY rs.observed_at,s.id").all(runId, kind ?? null, kind ?? null, selected ? 1 : 0);
}
function sourceById(db: DB, id: string): SourceRow { const row = db.query<SourceRow,[string]>("SELECT * FROM sources WHERE id=?").get(id); if (!row) throw new Error("Missing source"); return row; }
function listingById(db: DB, id: string): Listing { return decodeObject(sourceById(db, id).payload_json) as unknown as Listing; }
export function discoveryState(db: DB, runId: string): DiscoveryState {
  const task = runTasks(db, runId).find(t => t.stage === "discovery");
  if (!task) return { seeds: [], candidates: [], selected: [], completed: [], lookups: 0, developerCapRelaxed: false };
  const checkpoint = decodeObject(task.checkpoint_json);
  return { seeds: [], candidates: [], selected: [], completed: [], lookups: 0, developerCapRelaxed: false, ...checkpoint } as unknown as DiscoveryState;
}
function sourceQuotes(rows: SourceRow[]): QuoteSource[] {
  return rows.map(row => {
    const payload = decodeObject(row.payload_json); const provenance = row.provenance_json ? decodeObject(row.provenance_json) : {};
    return { id: row.id, text: String(payload.text ?? payload.description ?? ""), date: typeof payload.date === "string" ? payload.date : null,
      kind: row.kind as QuoteSource["kind"], url: row.url,
      provenance: row.kind === "listing" ? "official_listing" : row.kind === "review" ? "user_review" : typeof provenance.officialListingSourceId === "string" ? "official_website" : provenance.userSupplied === true ? "user_website" : "unknown" };
  });
}
function reviewPassages(text: string): string[] {
  const passages: string[] = [];
  for (let start = 0; start < text.length; start += 2000) {
    const passage = text.slice(start, start + 2000);
    if (passage) passages.push(passage);
  }
  return passages;
}
const reviewBody = (value: { text?: unknown; title?: unknown; rating?: unknown }) => hash({ text: value.text ?? "", title: value.title ?? "", rating: value.rating ?? null });
function persistSnapshot(db: DB, task: TaskRow, kind: SourceSnapshot["kind"], payload: Listing | WrittenReview, selected = false, version = COLLECTOR_VERSION): string {
  const content = json(payload); delete content.capturedAt; delete content.request;
  return saveSource(db, task.run_id, task.id, version, { kind, store: payload.store, appId: payload.appId,
    ...("reviewId" in payload && payload.reviewId ? { reviewId: payload.reviewId, identityVerified: payload.identityVerified } : {}),
    url: payload.url, locale: `${payload.country}:${payload.language}`, payload: content, capturedAt: payload.capturedAt },
  { country: payload.country, requestedLanguage: payload.language, request: payload.request, collectorVersion: COLLECTOR_VERSION }, selected);
}
function gap(db: DB, runId: string, key: string, reason: string): void {
  const coverage = decodeObject(getRun(db, runId).coverage_json);
  const gaps = Array.isArray(coverage.gaps) ? coverage.gaps : [];
  if (!gaps.some(g => typeof g === "object" && g && !Array.isArray(g) && g.key === key && g.reason === reason)) gaps.push({ key, reason });
  markCoverage(db, runId, { gaps: gaps.slice(0, 500) });
}
function relevance(listing: Listing, intent: string, category: boolean): Pick<Candidate, "relevance"|"reason"> {
  const words = [...new Set(intent.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(word => !["the","and","for","with","app","apps"].includes(word));
  const text = `${listing.title} ${listing.description} ${listing.category ?? ""}`.toLowerCase();
  const matches = words.filter(word => text.includes(word));
  if (words.length && matches.length === words.length) return { relevance: "direct", reason: `Captured listing mentions the scoped terms: ${matches.join(", ")}.` };
  if (matches.length) return { relevance: "adjacent", reason: `Captured listing mentions ${matches.join(", ")}; the full need is not established.` };
  if (category) return { relevance: "adjacent", reason: `Returned in the requested category chart (${listing.category ?? intent}); need fit needs review.` };
  return { relevance: "unrelated", reason: "Captured listing does not establish a connection to the scoped need." };
}
const candidateKey = (value: { store: Store; appId: string }) => `${value.store}:${value.appId}`;
function addSeed(state: DiscoveryState, seed: Seed): void {
  const old = state.seeds.find(s => candidateKey(s) === candidateKey(seed));
  if (old) { old.origins = [...new Set([...old.origins, ...seed.origins])]; old.included ||= seed.included; }
  else state.seeds.push(seed);
}

export function createResearchPipeline(db: DB, dependencies: ResearchDependencies = {}): { handlers: Handlers; planner: StagePlanner } {
  const stores = { apple: dependencies.apple ?? appleAdapter(), google: dependencies.google ?? googleAdapter() };
  const website = dependencies.website ?? collectWebsite; const now = dependencies.now ?? Date.now;
  const aiOptions = { transport: dependencies.aiTransport, configured: dependencies.aiConfigured };

  // Pasted research is fetched one page per third-party URL; only the company's own site may be followed further.
  const savePages = (task: TaskRow, pages: WebPage[], provenance: JsonObject): string[] => pages.map(page => saveSource(db, task.run_id, task.id, "website-v1", { kind: "website", url: page.url, locale: "", payload: json(page), capturedAt: page.capturedAt }, { userSupplied: true, pastedResearch: true, ...provenance }));
  const pageQuote = (sourceId: string): QuoteSource => { const row = sourceById(db, sourceId); return { id: row.id, text: String(decodeObject(row.payload_json).text ?? ""), kind: "website", url: row.url, provenance: "user_website" }; };
  const profileIdeas = async (task: TaskRow, signal: AbortSignal, run: RunRow, input: ReturnType<typeof researchInputSchema.parse>): Promise<JsonObject> => {
    const state = discoveryState(db, run.id);
    const ideas = state.ideas ??= input.ideas!.map(idea => ({ ...idea, pages: [], failures: [], profile: null, status: "pending" as const }));
    const save = () => checkpointTask(db, task.id, task.attempt_id!, json(state), undefined, now());
    for (const idea of ideas) {
      if (idea.status === "pending") {
        idea.pages = []; idea.failures = [];
        const fetched: { page: WebPage; official: boolean }[] = [];
        for (const request of [...(idea.officialUrl ? [{ url: idea.officialUrl, official: true, pages: 2 }] : []), ...idea.urls.map(url => ({ url, official: false, pages: 1 }))]) {
          signal.throwIfAborted();
          const result = await website(request.url, signal, undefined, request.pages);
          fetched.push(...result.pages.map(page => ({ page, official: request.official })));
          idea.failures.push(...result.failures.filter(failure => failure.reason !== "readable_text_limit").map(failure => ({ url: failure.url, reason: failure.reason })));
        }
        transaction(db, () => {
          assertAttempt(db, task.id, task.attempt_id!);
          for (const { page, official } of fetched) idea.pages.push({ url: page.url, official, sourceId: savePages(task, [page], { ideaId: idea.id, official })[0] });
          idea.status = idea.pages.length ? "fetched" : "no_sources";
          db.query("UPDATE tasks SET checkpoint_json=? WHERE id=?").run(encodeJson(state), task.id);
        });
        for (const failure of idea.failures) gap(db, run.id, `idea:${idea.id}:${failure.url}`, "A pasted source could not be read; claims that rest on it stay unverified");
      }
      if (idea.status !== "fetched") continue;
      if (aiOptions.configured === false) { idea.status = "not_profiled"; save(); gap(db, run.id, "idea_profiles", "Business profiles need AI analysis; fetched sources were kept without a profile"); continue; }
      try {
        const quotes = idea.pages.map(page => pageQuote(page.sourceId));
        const pages = idea.pages.map((page, index) => ({ sourceId: page.sourceId, url: page.url, official: page.official, text: quotes[index].text.slice(0, 12_000) }));
        idea.profile = json(await analyze(db, task, "business_profile", { sourceCountry: input.sourceCountry, targetCountry: input.targetCountry, name: idea.name, pastedSummary: idea.summary, pages }, quotes, signal, aiOptions));
        idea.status = "profiled";
      } catch (error) {
        if (error instanceof AiPaused || signal.aborted || getRun(db, run.id).status !== "running") throw error;
        idea.status = "failed"; gap(db, run.id, `idea:${idea.id}:profile`, "A business profile failed literal-source validation; its fetched sources were kept");
      }
      save();
    }
    return json({ ...state, noMatchingApps: false, unusedSlots: 0, intents: [] });
  };
  const checkIdeaMarkets = async (task: TaskRow, signal: AbortSignal, run: RunRow, input: ReturnType<typeof researchInputSchema.parse>): Promise<JsonObject> => {
    let checkpoint = decodeObject(task.checkpoint_json); const markets = (checkpoint.markets ?? []) as unknown as IdeaMarket[];
    for (const idea of discoveryState(db, run.id).ideas ?? []) {
      if (markets.some(market => market.id === idea.id)) continue;
      const finding = input.targetFindings?.find(finding => finding.id === idea.id);
      const market: IdeaMarket = { id: idea.id, presence: finding?.presence ?? null, note: finding?.note ?? "", urls: finding?.urls ?? [], equivalents: [], verdict: "not_researched" };
      const texts = new Map<string, string>(); const pages: (WebPage | null)[] = [];
      for (const equivalent of finding?.equivalents ?? []) {
        signal.throwIfAborted();
        const result = equivalent.url ? await website(equivalent.url, signal, undefined, 1) : null;
        pages.push(result?.pages[0] ?? null);
        if (result && !result.pages.length) gap(db, run.id, `idea:${idea.id}:${equivalent.url}`, "A reported local equivalent could not be read and stays unconfirmed");
        market.equivalents.push({ ...equivalent, sourceId: null, fit: null, reason: "" });
      }
      transaction(db, () => {
        assertAttempt(db, task.id, task.attempt_id!);
        pages.forEach((page, index) => { if (page) { const sourceId = savePages(task, [page], { ideaId: idea.id, targetMarket: true })[0]; market.equivalents[index].sourceId = sourceId; texts.set(sourceId, page.text); } });
      });
      const readable = market.equivalents.filter(equivalent => equivalent.sourceId);
      if (readable.length && aiOptions.configured !== false) try {
        const scope = { mode: "topic", query: typeof idea.profile?.whatItIs === "string" ? idea.profile.whatItIs : `${idea.name}. ${idea.summary}`, categories: [], urls: [], websiteUrls: [] };
        const screened = await analyze(db, task, "screening", { scope, candidates: readable.map((equivalent, index) => ({ index, title: equivalent.name, category: null, description: texts.get(equivalent.sourceId!)!.slice(0, 1500), store: "website", discoveryOrigins: [] })) }, [], signal, aiOptions);
        for (const result of screened.candidates) { readable[result.candidateIndex].fit = result.fit; readable[result.candidateIndex].reason = result.reason; }
      } catch (error) {
        if (error instanceof AiPaused || signal.aborted || getRun(db, run.id).status !== "running") throw error;
        gap(db, run.id, `idea:${idea.id}:equivalents`, "Reported local equivalents could not be screened for the same job");
      }
      // Lacuna cannot see how complete the outside research was, so an empty list is only ever "none reported".
      market.verdict = !finding ? "not_researched" : finding.presence === "operates" || finding.presence === "announced" ? "reported_present"
        : market.equivalents.some(equivalent => equivalent.fit === "core") ? "equivalent_confirmed" : market.equivalents.length ? "equivalent_unconfirmed" : "none_reported";
      markets.push(market); checkpoint = json({ ...checkpoint, markets }); checkpointTask(db, task.id, task.attempt_id!, checkpoint);
    }
    return json({ checks: [], counterparts: [], markets });
  };

  // A market-transfer survey keeps its sample in transfer_listings instead of the
  // checkpoint. Each step only picks up rows that have not reached it yet, so a
  // paused or interrupted run continues where it stopped.
  const surveyTransfer = async (task: TaskRow, signal: AbortSignal, run: RunRow, input: ReturnType<typeof researchInputSchema.parse>): Promise<JsonObject> => {
    const settings = researchSettings(decodeObject(run.settings_json)); const state = discoveryState(db, run.id);
    const source = planLocales("apple", [input.sourceCountry!])[0]; const target = planLocales("apple", [input.targetCountry!])[0]; const market = target.country;
    const enabled = settings.stores as Store[]; const limit = Number(settings.surveyLimit);
    const save = () => checkpointTask(db, task.id, task.attempt_id!, json(state), undefined, now());
    const guarded = (write: () => void) => transaction(db, () => { assertAttempt(db, task.id, task.attempt_id!); write(); });
    const count = (where = "1=1") => db.query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM transfer_listings WHERE run_id=? AND ${where}`).get(run.id)!.n;
    const pending = (store: Store, where: string, size: number) => db.query<{ app_id: string }, [string, Store, number]>(`SELECT app_id FROM transfer_listings WHERE run_id=? AND store=? AND ${where} ORDER BY rank,category,app_id LIMIT ?`).all(run.id, store, size).map(row => row.app_id);
    const update = (store: Store, appId: string, assignments: string, ...values: (string | number | null)[]) => db.query(`UPDATE transfer_listings SET ${assignments} WHERE run_id=? AND store=? AND app_id=?`).run(...values, run.id, store, appId);

    // Every chart is read before the sample is cut, so a small survey still spans all chosen categories and chart types.
    for (const collection of CHART_COLLECTIONS) for (const category of input.categories) for (const store of enabled) {
      const id = category[store]; if (!id) continue;
      const key = `chart:${id}:${store}:${source.country}:${collection}`;
      if (state.completed.includes(key)) continue;
      signal.throwIfAborted();
      try {
        const rows = (await stores[store].chart(id, source, signal, { collection, limit: LIMITS.transferChartResults })).slice(0, LIMITS.transferChartResults);
        guarded(() => rows.forEach((listing, rank) => {
          // Whatever the store returned is kept in the catalog, including apps beyond this survey's size.
          recordListing(db, listing, listing.capturedAt); recordAvailability(db, store, listing.appId, source.country, "available", listing.capturedAt);
          // An app keeps its best chart position.
          db.query("INSERT INTO transfer_listings(run_id,store,app_id,category,chart,rank) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id,store,app_id) DO UPDATE SET category=excluded.category,chart=excluded.chart,rank=excluded.rank WHERE excluded.rank<transfer_listings.rank").run(run.id, store, listing.appId, category.label, collection, rank);
        }));
      } catch { signal.throwIfAborted(); gap(db, run.id, key, "Store discovery unavailable for the requested scope"); }
      state.completed.push(key); save();
    }
    if (!state.completed.includes("survey:sized")) {
      // Keep the best-ranked apps across all charts; ties alternate between charts, categories and stores.
      guarded(() => db.query("DELETE FROM transfer_listings WHERE run_id=?1 AND (store,app_id) NOT IN (SELECT store,app_id FROM transfer_listings WHERE run_id=?1 ORDER BY rank,chart,category,store,app_id LIMIT ?2)").run(run.id, limit));
      state.completed.push("survey:sized"); save();
    }

    for (const store of enabled) {
      // A fresh earlier answer for this storefront settles an app without a request.
      guarded(() => db.query(`UPDATE transfer_listings SET cached=1,
          availability=(SELECT a.status FROM app_availability a WHERE a.store=transfer_listings.store AND a.app_id=transfer_listings.app_id AND a.country=?1),
          checked_at=(SELECT a.checked_at FROM app_availability a WHERE a.store=transfer_listings.store AND a.app_id=transfer_listings.app_id AND a.country=?1)
        WHERE run_id=?2 AND store=?3 AND availability='pending' AND EXISTS(SELECT 1 FROM app_availability a WHERE a.store=transfer_listings.store AND a.app_id=transfer_listings.app_id AND a.country=?1
          AND a.checked_at<=?4 AND ?4-a.checked_at < CASE a.status WHEN 'available' THEN ?5 ELSE ?6 END)`).run(market, run.id, store, now(), FRESHNESS.availableMs, FRESHNESS.unavailableMs));
      const bulk = stores[store].availability; const size = bulk ? LIMITS.transferBatch : 1; let failures = 0;
      for (;;) {
        signal.throwIfAborted();
        const group = pending(store, "availability='pending'", size); if (!group.length) break;
        // A store that keeps failing is rate limiting or down; asking on would only turn the rest into unknowns.
        if (failures >= (bulk ? LIMITS.transferBatchFailures : LIMITS.transferSingleFailures)) { gap(db, run.id, `availability:${store}`, "The store stopped answering availability checks; the remaining sampled apps were left unchecked"); break; }
        // Only an explicit not-found is absence; any other failure must never read as a gap.
        let outcome: (appId: string) => TargetAvailability = () => "unknown";
        try {
          if (bulk) {
            const listed = await bulk(group, target, signal);
            // An empty answer for a whole batch is far more likely a throttled or broken response than a batch of gaps.
            if (group.length > 1 && !listed.size) throw new Error("empty_bulk_answer");
            outcome = appId => listed.has(appId) ? "available" : "unavailable";
          }
          else { await stores[store].details(group[0], target, signal); outcome = () => "available"; }
        } catch (error) { signal.throwIfAborted(); if (!bulk && listingMissing(error)) outcome = () => "unavailable"; }
        failures = group.every(appId => outcome(appId) === "unknown") ? failures + 1 : 0;
        guarded(() => { for (const appId of group) { const result = outcome(appId); if (result !== "unknown") recordAvailability(db, store, appId, market, result, now()); update(store, appId, "availability=?,checked_at=?", result, now()); } });
      }
    }
    if (count("availability='unknown'")) gap(db, run.id, "availability_unknown", "Target-market availability could not be established for some sampled apps; none of them were treated as missing");

    for (const store of enabled) {
      const bulk = stores[store].detailsMany; const size = bulk ? LIMITS.transferBatch : 1; let failures = 0;
      for (;;) {
        signal.throwIfAborted();
        const group = pending(store, "availability='unavailable' AND source_id IS NULL AND fit IS NULL", size); if (!group.length) break;
        if (failures >= (bulk ? LIMITS.transferBatchFailures : LIMITS.transferSingleFailures)) { gap(db, run.id, `details:${store}`, "The store stopped answering listing requests; some apps missing from the target storefront have no details"); break; }
        const listings = new Map<string, Listing>();
        for (const appId of group) {
          const cached = db.query<SourceRow & { observed_at: number }, [Store, string, string, number]>("SELECT s.*,rs.observed_at FROM sources s JOIN run_sources rs ON rs.source_id=s.id WHERE s.kind='listing' AND s.store=? AND s.app_id=? AND s.locale=? AND rs.observed_at>=? ORDER BY rs.observed_at DESC LIMIT 1").get(store, appId, `${source.country}:${source.language}`, now() - FRESHNESS.catalogListingMs);
          if (cached) listings.set(appId, { ...decodeObject(cached.payload_json), request: { reusedSourceId: cached.id, observedAt: cached.observed_at }, capturedAt: cached.observed_at } as unknown as Listing);
        }
        const wanted = group.filter(appId => !listings.has(appId)); let answered = !wanted.length;
        if (wanted.length) try {
          for (const listing of bulk ? await bulk(wanted, source, signal) : [await stores[store].details(wanted[0], source, signal)]) if (wanted.includes(listing.appId)) listings.set(listing.appId, listing);
          answered = true;
        } catch { signal.throwIfAborted(); }
        failures = answered ? 0 : failures + 1;
        // An app the source store no longer returns is not a lead: its absence elsewhere means nothing.
        guarded(() => { for (const appId of group) { const listing = listings.get(appId); if (listing) update(store, appId, "source_id=?", persistSnapshot(db, task, "listing", listing)); else if (answered) update(store, appId, "fit='no_details'"); } });
        if (!answered && !bulk) guarded(() => update(store, group[0], "fit='no_details'"));
      }
    }

    if (count("fit='no_details'")) gap(db, run.id, "details_missing", "Details could not be read for some apps missing from the target storefront; they are not listed as leads");
    const scope = { sourceCountry: input.sourceCountry!, targetCountry: market, targetLanguage: target.language, focus: input.query || null };
    const settle = (store: Store, appId: string, verdict: TransferVerdict) => update(store, appId, "fit=?,assessment_json=?", verdict.fit, encodeJson(verdict));
    for (let round = 0; ; round++) {
      signal.throwIfAborted();
      const batch = db.query<{ store: Store; app_id: string; source_id: string }, [string]>("SELECT store,app_id,source_id FROM transfer_listings WHERE run_id=? AND availability='unavailable' AND source_id IS NOT NULL AND fit IS NULL ORDER BY rank,store,app_id LIMIT 25").all(run.id);
      if (!batch.length) break;
      const entries = batch.map(row => {
        const listing = listingById(db, row.source_id);
        const content = { title: listing.title, developer: listing.developer, category: listing.category ?? null, description: listing.description.slice(0, 1500), store: listing.store };
        return { row, content, key: { store: row.store, appId: row.app_id, sourceCountry: scope.sourceCountry, targetCountry: market, inputHash: hash({ content, scope, model: settings.model, prompt: PROMPT_VERSION }) } };
      });
      // An earlier verdict on the same listing text, scope, model and prompt is reused instead of paid for again.
      const fresh = entries.filter(entry => {
        const stored = transferVerdict.safeParse(knownScreening(db, entry.key));
        if (stored.success) guarded(() => settle(entry.row.store, entry.row.app_id, stored.data));
        return !stored.success;
      });
      if (!fresh.length) continue;
      const unscreened = () => guarded(() => { for (const { row } of fresh) update(row.store, row.app_id, "fit='unscreened'"); });
      if (aiOptions.configured === false) { unscreened(); gap(db, run.id, "transfer_screening", "Transferability screening needs AI analysis; missing apps were kept unscreened"); continue; }
      try {
        const screened = await analyze(db, task, "transfer", { ...scope, candidates: fresh.map((entry, index) => ({ index, ...entry.content })) }, [], signal, aiOptions);
        guarded(() => {
          for (const { candidateIndex, ...result } of screened.candidates) {
            const { row, key } = fresh[candidateIndex];
            settle(row.store, row.app_id, result); recordScreening(db, key, json(result), now()); recordSummary(db, key.store, key.appId, result.coreFunctionality);
          }
        });
      } catch (error) {
        if (error instanceof AiPaused || signal.aborted || getRun(db, run.id).status !== "running") throw error;
        unscreened(); gap(db, run.id, `transfer_screening:${round}`, "Transferability screening failed validation; missing apps were kept unscreened");
      }
    }

    // The target-market search is the expensive step, so it goes to the leads with the most source-market ratings.
    state.candidates = transferLeadRows(db, run.id, settings.exploreAppLimit).map(row => {
      const verdict = transferVerdict.safeParse(row.assessment_json ? decodeObject(row.assessment_json) : null).data; const listing = decodeObject(row.payload_json) as unknown as Listing;
      return { store: row.store, appId: row.app_id, developerId: listing.developerId, intent: row.category, country: source.country, language: source.language, rank: row.rank, included: false, origins: [`chart:${row.chart}`], sourceId: row.source_id, title: listing.title,
        relevance: verdict ? "direct" as const : "adjacent" as const, cohortFit: verdict ? "core" as const : "adjacent" as const, reason: verdict?.reason ?? `Not found in the ${market} storefront; dependence on the source market was not screened.`,
        targetAvailability: "unavailable" as const, ...(row.checked_at === null ? {} : { targetCheckedAt: row.checked_at }),
        ...(verdict ? { transferFit: verdict.fit, coreFunctionality: verdict.coreFunctionality, targetSearchTerms: verdict.targetSearchTerms, barriers: verdict.barriers } : {}) };
    });
    state.selected = state.candidates;
    if (count("availability='pending'")) gap(db, run.id, "availability_limit", "Some sampled apps were not checked in the target storefront");
    state.transfer = json({ sourceCountry: input.sourceCountry, targetCountry: market, targetLanguage: target.language, sampled: count(), checked: count("availability!='pending'"), available: count("availability='available'"), unavailable: count("availability='unavailable'"), unknown: count("availability='unknown'"), unchecked: count("availability='pending'"), cached: count("cached=1"), transferable: count("fit='transferable'"), marketSpecific: count("fit='market_specific'") });
    save();
    return json({ ...state, noMatchingApps: false, unusedSlots: settings.exploreAppLimit - state.selected.length, intents: [] });
  };

  const discover = async (task: TaskRow, signal: AbortSignal): Promise<JsonObject> => {
    const run = getRun(db, task.run_id); const settings = researchSettings(decodeObject(run.settings_json)); const input = researchInputSchema.parse(decodeObject(run.input_json));
    if (input.mode === "ideas") return profileIdeas(task, signal, run, input);
    if (input.mode === "transfer") return surveyTransfer(task, signal, run, input);
    const state = discoveryState(db, run.id); const intents = searchIntents(input, settings.preset);
    const enabled = settings.stores as Store[]; const locales = settings.countries.map(country => planLocales("apple", [country])[0]);
    const broad = broadDiscovery(input.mode);
    const metadataLimit = broad ? settings.discoveryLimit : PRESETS[settings.preset].metadataLookups;
    const appLimit = broad ? settings.exploreAppLimit : settings.appLimit;
    // Explore keeps allowance for its niche searches.
    const broadLimit = input.mode === "explore" ? Math.max(2, Math.floor(metadataLimit * 0.6)) : metadataLimit;
    const save = (write?: () => void) => checkpointTask(db, task.id, task.attempt_id!, json(state), write, now());
    for (const url of input.urls) { const reference = parseStoreUrl(url); addSeed(state, { ...reference, country: reference.country ?? settings.countries[0], language: "en", rank: -1, intent: input.query || "Explicit inclusion", included: true, origins: [`included:${url}`] }); }
    if (state.seeds.filter(seed => seed.included).length > appLimit) throw new Error("Explicit inclusions exceed listing cap");
    const requests: { key: string; store: Store; locale: Locale; intent: string; category?: string }[] = [];
    // Stable round-robin over intents, country and store before metadata truncation.
    for (let index = 0; index < Math.max(intents.length, input.categories.length); index++) for (const locale of locales) for (const store of enabled) {
      if (intents[index]) requests.push({ key: `search:${index}:${store}:${locale.country}`, store, locale, intent: intents[index] });
      const category = input.categories[index]; if (category?.[store]) requests.push({ key: `chart:${category[store]}:${store}:${locale.country}`, store, locale, intent: category.label, category: category[store]! });
    }
    for (const request of requests) {
      if (state.completed.includes(request.key)) continue; signal.throwIfAborted();
      try {
        const found = request.category ? await stores[request.store].chart(request.category, request.locale, signal) : await stores[request.store].search(request.intent, request.locale, signal);
        const bounded = found.slice(0, request.category ? LIMITS.chartResults : LIMITS.searchResults);
        (state.requests ??= []).push({ key: request.key, store: request.store, ...request.locale, intent: request.intent, ids: bounded.map(listing => listing.appId), request: bounded[0]?.request ?? { country: request.locale.country, language: request.locale.language, query: request.intent, category: request.category ?? null } });
        bounded.forEach((listing, rank) => addSeed(state, { ...request.locale, store: request.store, appId: listing.appId, intent: request.intent, rank, origins: [request.key], included: false }));
        // Whatever the store returned is kept in the catalog, including apps this run never looks up.
        transaction(db, () => { for (const listing of bounded) { recordListing(db, listing, listing.capturedAt); recordAvailability(db, listing.store, listing.appId, request.locale.country, "available", listing.capturedAt); } });
        const included = state.seeds.filter(seed => seed.included);
        const pool = metadataCandidates(state.seeds.map(seed => ({ ...seed, developerId: "unknown", relevance: "adjacent" as const, reason: "Awaiting listing details" })), settings.preset, broadLimit);
        const retained = new Set([...included, ...pool].slice(0, broadLimit).map(candidateKey));
        state.seeds = state.seeds.filter(seed => retained.has(candidateKey(seed)));
      } catch { signal.throwIfAborted(); gap(db, run.id, request.key, "Store discovery unavailable for the requested scope"); }
      state.completed.push(request.key); save();
    }
    const lookup = async (seed: Seed, limit = metadataLimit) => {
      const key = `details:${candidateKey(seed)}`;
      if (state.completed.includes(key)) return;
      // Reusing a recently captured listing page costs no lookup allowance.
      const cached = db.query<SourceRow & { observed_at: number }, [Store,string,string,number]>("SELECT s.*,rs.observed_at FROM sources s JOIN run_sources rs ON rs.source_id=s.id WHERE s.kind='listing' AND s.store=? AND s.app_id=? AND s.locale=? AND rs.observed_at>=? ORDER BY rs.observed_at DESC LIMIT 1").get(seed.store, seed.appId, `${seed.country}:${seed.language}`, now() - FRESHNESS.listingMs);
      if (!cached) { if (state.lookups >= limit) return; state.lookups++; save(); }
      try {
        const listing = cached ? { ...decodeObject(cached.payload_json), request: { reusedSourceId: cached.id, observedAt: cached.observed_at }, capturedAt: cached.observed_at } as unknown as Listing : await stores[seed.store].details(seed.appId, seed, signal);
        const assessment = seed.included ? { relevance: "direct" as const, reason: "Explicitly included by you; listing content captured for review." } : relevance(listing, seed.intent, seed.origins.some(o => o.startsWith("chart:")) && !input.query);
        const candidate: CandidateRecord = { ...seed, ...assessment, developerId: listing.developerId, sourceId: "", title: listing.title };
        // Sources and the corresponding progressive candidate are committed together.
        transaction(db, () => {
          assertAttempt(db, task.id, task.attempt_id!);
          candidate.sourceId = persistSnapshot(db, task, "listing", listing); state.candidates.push(candidate);
          state.completed.push(key);
          db.query("UPDATE tasks SET checkpoint_json=? WHERE id=?").run(encodeJson(state), task.id);
        });
      } catch { signal.throwIfAborted(); assertAttempt(db, task.id, task.attempt_id!); state.completed.push(key); save(); gap(db, run.id, key, "Listing details unavailable; candidate was not silently substituted"); }
    };
    for (const seed of state.seeds.filter(s => s.included)) await lookup(seed);
    const ordered = metadataCandidates(state.seeds.map(seed => ({ ...seed, developerId: "unknown", relevance: "adjacent" as const, reason: "Awaiting captured listing content" })), settings.preset, broadLimit);
    for (const item of ordered) await lookup(state.seeds.find(s => candidateKey(s) === candidateKey(item))!, broadLimit);
    for (const seed of (broad ? [] : state.candidates.filter(c => c.relevance !== "unrelated").slice(0, LIMITS.relatedSeeds))) {
      const key = `related:${candidateKey(seed)}`; if (state.completed.includes(key)) continue;
      try {
        const related = await stores[seed.store].related(seed.appId, { country: seed.country, language: seed.language }, signal);
        for (const [rank, listing] of related.slice(0, LIMITS.relatedPerSeed).entries()) addSeed(state, { store: seed.store, appId: listing.appId, country: seed.country, language: seed.language, intent: seed.intent, rank, origins: [key], included: false });
      } catch { signal.throwIfAborted(); gap(db, run.id, key, "Related listings unavailable"); }
      state.completed.push(key); save();
    }
    for (const seed of state.seeds) await lookup(seed);
    for (const candidate of state.candidates) candidate.origins = [...new Set([...(state.seeds.find(seed => candidateKey(seed) === candidateKey(candidate))?.origins ?? candidate.origins), ...(state.requests ?? []).filter(request => request.store === candidate.store && request.ids.includes(candidate.appId)).map(request => request.key)])];
    let automatic = state.candidates.filter(candidate => !candidate.included);
    let screeningScope: JsonObject = json(input);
    let explorationReady = input.mode !== "explore";
    if (input.mode === "explore" && automatic.length >= 2) {
      try {
        const candidates = automatic.map((candidate, index) => {
          const listing = listingById(db, candidate.sourceId);
          return { index, title: listing.title, category: listing.category ?? null, description: listing.description.slice(0, 500), store: listing.store, rating: listing.rating, ratingTotal: listing.ratingTotal };
        });
        const lead = await analyze(db, task, "exploration", { focus: input.query || null, candidates }, [], signal, aiOptions);
        state.exploration = json(lead);
        screeningScope = { mode: "topic", query: `${lead.title}. ${lead.problem}. Audience: ${lead.audience}`, categories: [], urls: [], websiteUrls: [] };
        explorationReady = true;
        save();
        const terms = Array.isArray(lead.searchTerms) ? lead.searchTerms.filter((term): term is string => typeof term === "string" && !!term.trim()).slice(0, PRESETS[settings.preset].searchIntents) : [];
        const before = new Set(state.seeds.map(candidateKey));
        for (const [termIndex, term] of terms.entries()) for (const locale of locales) for (const store of enabled) {
          const key = `explore-search:${termIndex}:${store}:${locale.country}`;
          if (state.completed.includes(key)) continue;
          try {
            const found = (await stores[store].search(term, locale, signal)).slice(0, LIMITS.searchResults);
            (state.requests ??= []).push({ key, store, ...locale, intent: term, ids: found.map(listing => listing.appId), request: found[0]?.request ?? { country: locale.country, language: locale.language, query: term, category: null } });
            found.forEach((listing, rank) => addSeed(state, { ...locale, store, appId: listing.appId, intent: term, rank, origins: [key], included: false }));
          } catch { signal.throwIfAborted(); gap(db, run.id, key, "Niche competition search was unavailable for the requested scope"); }
          state.completed.push(key); save();
        }
        const expansion = state.seeds.filter(seed => !before.has(candidateKey(seed)));
        const remaining = Math.max(0, metadataLimit - state.lookups);
        const expanded = metadataCandidates(expansion.map(seed => ({ ...seed, developerId: "unknown", relevance: "adjacent" as const, reason: "Awaiting niche-search listing details" })), settings.preset, remaining);
        for (const item of expanded) await lookup(state.seeds.find(seed => candidateKey(seed) === candidateKey(item))!);
        for (const candidate of state.candidates) candidate.origins = [...new Set([...(state.seeds.find(seed => candidateKey(seed) === candidateKey(candidate))?.origins ?? candidate.origins), ...(state.requests ?? []).filter(request => request.store === candidate.store && request.ids.includes(candidate.appId)).map(request => request.key)])];
        automatic = state.candidates.filter(candidate => !candidate.included);
      } catch (error) {
        if (error instanceof AiPaused || signal.aborted || getRun(db, run.id).status !== "running") throw error;
        gap(db, run.id, "exploration", "Niche exploration failed validation; no broad-scope apps were treated as one competitor cohort");
      }
    } else if (input.mode === "explore") {
      gap(db, run.id, "exploration", "Fewer than two usable app listings were available for niche exploration");
    }
    for (let offset = 0; offset < automatic.length; offset += 25) {
      const batch = automatic.slice(offset, offset + 25);
      if (!explorationReady) {
        for (const candidate of batch) { candidate.cohortFit = "unrelated"; candidate.relevance = "unrelated"; }
        continue;
      }
      if (aiOptions.configured === false) {
        for (const candidate of batch) {
          candidate.cohortFit = candidate.relevance === "direct" ? "core" : "unrelated";
          if (candidate.cohortFit !== "core") candidate.relevance = "unrelated";
        }
        continue;
      }
      try {
        const candidates = batch.map((candidate, index) => {
          const listing = listingById(db, candidate.sourceId);
          return { index, title: listing.title, category: listing.category ?? null, description: listing.description.slice(0, input.mode === "explore" ? 1500 : 5000), store: listing.store, discoveryOrigins: candidate.origins };
        });
        const screened = await analyze(db, task, "screening", { scope: screeningScope, candidates }, [], signal, aiOptions);
        for (const result of screened.candidates) {
          const candidate = batch[result.candidateIndex];
          candidate.cohortFit = result.fit;
          candidate.coreFunctionality = result.coreFunctionality;
          candidate.reason = result.reason;
          candidate.relevance = result.fit === "core" ? "direct" : "unrelated";
          recordSummary(db, candidate.store, candidate.appId, result.coreFunctionality);
        }
      } catch (error) {
        if (error instanceof AiPaused || signal.aborted || getRun(db, run.id).status !== "running") throw error;
        for (const candidate of batch) {
          candidate.cohortFit = candidate.relevance === "direct" ? "core" : "unrelated";
          if (candidate.cohortFit !== "core") candidate.relevance = "unrelated";
        }
        gap(db, run.id, `screening:${offset}`, "Functional cohort screening failed; only strict lexical matches were retained");
      }
      save();
    }
    if (input.mode === "explore" && state.exploration) {
      const core = state.candidates.filter(candidate => candidate.cohortFit === "core");
      const observedAppCount = new Set(core.map(candidateKey)).size;
      const observedDeveloperCount = new Set(core.map(candidate => candidate.developerId)).size;
      const observedStores = [...new Set(core.map(candidate => candidate.store))];
      const saturationSignal = observedAppCount <= 5 ? "few competitors observed in this bounded sample" : observedAppCount <= 15 ? "some competition observed in this bounded sample" : "many competitors observed in this bounded sample";
      state.exploration = json({ ...state.exploration, observedAppCount, observedDeveloperCount, observedStores, saturationSignal, sampleSize: state.candidates.length });
      for (const candidate of core) candidate.intent = `explore:${String(state.exploration.title)}`;
    }
    const selection = selectCandidates(state.candidates, appLimit);
    state.selected = selection.selected as CandidateRecord[]; state.developerCapRelaxed = selection.developerCapRelaxed; save();
    if (state.lookups >= metadataLimit) gap(db, run.id, "metadata_limit", "Candidate discovery metadata lookup limit reached");
    return json({ ...state, noMatchingApps: !state.selected.length, unusedSlots: appLimit - state.selected.length, intents });
  };

  const collect = async (task: TaskRow, signal: AbortSignal): Promise<JsonObject> => {
    if (task.kind === "no_reviews") return { selected: 0, reason: "No review allowance or selected apps" };
    const run = getRun(db, task.run_id); const settings = researchSettings(decodeObject(run.settings_json));
    const details = decodeObject(task.checkpoint_json); let checkpoint = parseCollectionCheckpoint(task.checkpoint_json);
    const store = details.store as Store; const appId = String(details.appId); const locale = { country: String(details.country), language: String(details.language) };
    const save = (write?: () => void) => {
      const siblings = runTasks(db, run.id).filter(other => other.kind === "review_stream" && other.status !== "superseded").map(other => ({ task: other, value: other.id === task.id ? json({ ...details, ...checkpoint }) : decodeObject(other.checkpoint_json) })).filter(other => other.value.store === store && other.value.appId === appId).sort((a, b) => Number(a.value.streamIndex) - Number(b.value.streamIndex));
      // Unvisited streams retain their share. Exhausted/failed streams release
      // unavailable slots; active streams and quota-stopped streams may grow.
      // Cached segments contribute captured coverage but never extend old cursors.
      const quotas = allocateReviews(Number(details.appQuota), siblings.map(({ value }) => !value.reusedTaskId && (!value.complete || value.stopReason === "pool_limit") ? Number(details.appQuota) : Number(value.uniqueCount)), false);
      const changes = siblings.map(({ task: sibling, value }, index) => {
        const reopened = value.complete && value.stopReason === "pool_limit" && !value.reusedTaskId && Number(value.uniqueCount) < quotas[index] * LIMITS.poolMultiplier && value.cursor !== null && (store !== "apple" || Number(value.pages) < LIMITS.appleStreamPages) && collectionRequestCount(db, run.id) < PRESETS[settings.preset].reviewPageRequests;
        return { task: sibling, value: { ...value, quota: quotas[index], ...(reopened ? { complete: false, stopReason: null, endedAt: null } : {}) }, reopened };
      });
      const current = changes.find(change => change.task.id === task.id)!;
      checkpoint = parseCollectionCheckpoint(encodeJson(current.value));
      checkpointTask(db, task.id, task.attempt_id!, json({ ...details, ...checkpoint }), () => {
        write?.();
        for (const change of changes) if (change.task.id !== task.id) {
          if (change.reopened && change.task.status === "completed") db.query("UPDATE tasks SET status='pending',attempt_id=NULL,result_json=NULL,checkpoint_json=? WHERE id=?").run(encodeJson(change.value), change.task.id);
          else db.query("UPDATE tasks SET checkpoint_json=? WHERE id=?").run(encodeJson(change.value), change.task.id);
        }
      }, now());
    };
    if (now() - checkpoint.startedAt >= FRESHNESS.collectionMs) { replaceCollectionTask(db, task.id, "stale", now()); return { replaced: true }; }
    const currentTasks = new Set(runTasks(db, run.id).filter(t => t.stage === "collection" && t.status !== "superseded").map(t => t.id));
    const appReviews = () => sourcesForRun(db, run.id, "review").filter(source => source.store === store && source.app_id === appId && currentTasks.has(source.task_id!));
    if (!checkpoint.pages && !checkpoint.requestAttempts) {
      const previous = db.query<TaskRow,[string]>("SELECT * FROM tasks WHERE stage='collection' AND status='completed' AND run_id!=? ORDER BY updated_at DESC LIMIT 400").all(run.id).find(old => {
        const oldCheckpoint = parseCollectionCheckpoint(old.checkpoint_json);
        return collectionReuse(oldCheckpoint, checkpoint.scopeHash, checkpoint.quota, now(), false) === "reuse";
      });
      if (previous) {
        const oldRows = sourcesForRun(db, previous.run_id, "review").filter(row => row.task_id === previous.id);
        const currentRows = sourcesForRun(db, run.id, "review").filter(row => row.store === store && row.app_id === appId);
        const conflicts = [...new Set(oldRows.filter(old => old.review_id && currentRows.some(current => current.review_id === old.review_id && reviewBody(decodeObject(current.payload_json)) !== reviewBody(decodeObject(old.payload_json)))).map(row => row.review_id!))];
        if (conflicts.length) save(() => {
          for (const id of conflicts) disqualifyReview(db, run.id, store, appId, id);
          gap(db, run.id, `identity:${store}:${appId}`, "Conflicting cached review content disqualified the logical ID; the locale must be collected again");
        });
        // Never reuse a segment containing identity-quarantined observations.
        if (oldRows.length && oldRows.every(row => row.logical_review_key && !reviewDisqualified(db, run.id, store, appId, row.review_id!))) {
          const old = parseCollectionCheckpoint(previous.checkpoint_json);
          details.reusedTaskId = previous.id;
          checkpoint = { ...checkpoint, startedAt: old.startedAt, endedAt: old.endedAt, complete: true, uniqueCount: old.uniqueCount, stopReason: old.stopReason };
          save(() => { for (const row of oldRows) saveSource(db, run.id, task.id, checkpoint.version, { kind: "review", store, appId, reviewId: row.review_id!, identityVerified: true, locale: `${locale.country}:${locale.language}`, url: row.url, payload: decodeObject(row.payload_json), capturedAt: old.endedAt! }, { requestedCountry: locale.country, requestedLanguage: locale.language, reusedTaskId: previous.id, observedAt: old.endedAt, originalCapturedAt: row.captured_at }); });
          return json({ ...checkpoint, reusedTaskId: previous.id });
        }
      }
    }
    const rawKeys = new Set(appReviews().map(source => source.review_id ?? decodeObject(source.payload_json).rawFingerprint as string));
    if (checkpoint.complete) return json(checkpoint);
    if (collectionRequestCount(db, run.id) >= PRESETS[settings.preset].reviewPageRequests || checkpoint.pages > 0 && checkpoint.uniqueCount >= checkpoint.quota * LIMITS.poolMultiplier) {
      checkpoint = { ...checkpoint, complete: true, endedAt: now(), stopReason: collectionRequestCount(db, run.id) >= PRESETS[settings.preset].reviewPageRequests ? "request_limit" : "pool_limit" };
      save(() => { if (checkpoint.stopReason === "request_limit") gap(db, run.id, task.dedupe_key, checkpoint.pages ? "Stream truncated by the run request limit" : "Planned stream was not visited because the run request limit was reached"); });
      return checkpoint.complete ? json(checkpoint) : { continue: true };
    }
    let page: Awaited<ReturnType<StoreAdapter["reviews"]>> | null = null;
    let failureReason = "access_failure";
    for (let attempt = Number(details.pageAttempts ?? 0); attempt < LIMITS.requestAttempts && collectionRequestCount(db, run.id) < PRESETS[settings.preset].reviewPageRequests; attempt++) {
      signal.throwIfAborted(); checkpoint.requestAttempts++; details.pageAttempts = attempt + 1; save();
      try { page = await stores[store].reviews(appId, locale, checkpoint.cursor, signal); break; }
      catch (error) {
        signal.throwIfAborted(); assertAttempt(db, task.id, task.attempt_id!);
        const failure = collectionFailure(error);
        if (failure.code === "cursor_invalid") {
          if (!details.previousTaskId) { replaceCollectionTask(db, task.id, "cursor_invalid", now()); return { replaced: true }; }
          failureReason = "cursor_invalid_after_restart"; break;
        }
        if (failure.code === "access_denied" || failure.code === "rate_limited") { failureReason = failure.code; break; }
        if (attempt + 1 < LIMITS.requestAttempts) await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new Error("aborted")); }; const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, LIMITS.retryBaseMs * (attempt + 1)); signal.addEventListener("abort", abort, { once: true });
        });
      }
    }
    if (!page) { checkpoint = { ...checkpoint, complete: true, endedAt: now(), stopReason: failureReason }; save(() => gap(db, run.id, task.dedupe_key, `Review collection stopped: ${failureReason}`)); return json(checkpoint); }
    details.pageAttempts = 0;
    const idBodies = new Map<string, Set<string>>();
    // Compare content against every earlier observation in this run, including
    // completed locale streams and replacement segments. Retrieval dates and
    // locale request parameters are not content differences.
    for (const row of sourcesForRun(db, run.id, "review").filter(row => row.store === store && row.app_id === appId && row.review_id)) {
      const bodies = idBodies.get(row.review_id!) ?? new Set(); bodies.add(reviewBody(decodeObject(row.payload_json))); idBodies.set(row.review_id!, bodies);
    }
    for (const review of page.reviews) if (review.reviewId) { const bodies = idBodies.get(review.reviewId) ?? new Set(); bodies.add(reviewBody(review)); idBodies.set(review.reviewId, bodies); }
    const collided = [...idBodies].filter(([, bodies]) => bodies.size > 1).map(([id]) => id);
    const reviewed = page.reviews.map(review => collided.includes(review.reviewId ?? "") || !!review.reviewId && reviewDisqualified(db, run.id, store, appId, review.reviewId) ? { ...review, identityVerified: false, identityReason: "conflicting_review_content" } : review);
    const newIds = new Set(reviewed.map(review => review.reviewId ?? review.rawFingerprint).filter(id => !rawKeys.has(id)));
    const history = (details.pageRequests ?? []) as JsonObject[];
    history.push({ request: page.request, capturedAt: now(), returned: reviewed.length, incrementalUnique: newIds.size, duplicateIds: reviewed.length - newIds.size, overlap: reviewed.length ? (reviewed.length - newIds.size) / reviewed.length : 0, responseFingerprint: hash(reviewed.map(review => review.rawFingerprint)) });
    details.pageRequests = history;
    checkpoint.pages++; checkpoint.uniqueCount += newIds.size; checkpoint.noNewIdPages = newIds.size ? 0 : checkpoint.noNewIdPages + 1;
    checkpoint.seenCursors = [...checkpoint.seenCursors, checkpoint.cursor ?? "__first__"];
    const stop = pageStop(checkpoint, store, settings.preset, collectionRequestCount(db, run.id), page.nextCursor, page.exhausted);
    checkpoint.cursor = page.nextCursor; checkpoint.stopReason = stop; checkpoint.complete = stop !== null; checkpoint.endedAt = stop ? now() : null;
    save(() => {
      for (const review of reviewed) persistSnapshot(db, task, "review", review, false, checkpoint.version);
      for (const id of collided) disqualifyReview(db, run.id, store, appId, id);
      if (reviewed.some(review => !review.identityVerified)) gap(db, run.id, `identity:${store}:${appId}`, "Reviews with unvalidated or unstable identity are quarantined from support counts and analysis reuse");
      if (stop && !["pool_limit", "exhausted"].includes(stop)) gap(db, run.id, task.dedupe_key, `Collection stopped at ${stop}`);
    });
    return checkpoint.complete ? json({ ...checkpoint, returnedIds: reviewed.length }) : { continue: true };
  };

  const analysis = async (task: TaskRow, signal: AbortSignal): Promise<JsonObject> => {
    const checkpoint = decodeObject(task.checkpoint_json); const sourceId = checkpoint.sourceId;
    if (typeof sourceId !== "string") return { findings: [], message: "No trusted selected written reviews available" };
    const settings = researchSettings(decodeObject(getRun(db, task.run_id).settings_json));
    const spokenLanguages = (settings.spokenLanguages as string[]).map(normalizeLanguageTag);
    const translationLanguage = spokenLanguages[0];
    const sources = [sourceById(db, sourceId)]; const quotes = sourceQuotes(sources);
    const passages = reviewPassages(quotes[0].text); if (!passages.length) return { findings: [] };
    const review = { ...decodeObject(sources[0].payload_json) }; delete review.text;
    try {
      const output = await analyze(db, task, "extraction", { scope: decodeObject(getRun(db, task.run_id).input_json), review: { ...review, spokenLanguages, translationLanguage, passages: passages.map((text, index) => ({ index, text })) } }, quotes, signal, aiOptions);
      const translationRequired = output.findings.length > 0 && !languageMatchesAny(output.originalLanguage, spokenLanguages);
      if (translationRequired && !output.translation) throw new Error("invalid_review_translation");
      const translation = translationRequired ? output.translation : null;
      if (translation && normalizeLanguageTag(translation.language) !== translationLanguage) throw new Error("invalid_translation_language");
      const findings = output.findings.map(({ excerptIndex, ...finding }, index) => {
        const excerpt = passages[excerptIndex]; if (!excerpt) throw new Error("unknown_review_passage");
        const translated = index === 0 && translation;
        return { ...finding, sourceId, excerpt, originalLanguage: output.originalLanguage, ...(translated ? { translation: translated, translationScope: "full_review" as const } : { translation: null, translationScope: null }), date: quotes[0].date ?? null };
      });
      validateCitations({ findings }, quotes);
      return json({ findings });
    } catch (error) { if (error instanceof AiPaused || signal.aborted || getRun(db, task.run_id).status !== "running") throw error; gap(db, task.run_id, task.dedupe_key, "Analysis batch failed schema or evidence validation"); return { findings: [], failed: true }; }
  };
  const grouping = async (task: TaskRow, signal: AbortSignal): Promise<JsonObject> => {
    const findings = allFindings(db, task.run_id); if (!findings.length) return { themes: [], opportunities: [] };
    const sources = sourcesForRun(db, task.run_id, "review", true); const quotes = sourceQuotes(sources);
    let checkpoint = decodeObject(task.checkpoint_json);
    // Each chunk stays bounded; grouping is then consolidated from compact themes.
    const groupRefs = (checkpoint.groupRefs ?? []) as Array<string | null>;
    const themeBatches = (checkpoint.themeBatches ?? []) as JsonObject[][];
    try {
      for (let offset = themeBatches.length * 100; offset < findings.length; offset += 100) {
        const batch = findings.slice(offset, offset + 100); const ids = new Set(batch.map(f => f.sourceId));
        try {
          const output = await analyze(db, task, "grouping", { findings: batch }, quotes.filter(q => ids.has(q.id)), signal, aiOptions);
          const stored = db.query<{ id: string }, [string]>("SELECT id FROM analyses WHERE stage='grouping' AND output_json=? LIMIT 1").get(encodeJson(output));
          if (!stored) throw new Error("Grouping analysis was not persisted");
          const themes = output.themes.map(({ findingIndexes, ...theme }) => {
            const sourceIds = [...new Set(findingIndexes.map(index => {
              const finding = batch[index]; if (!finding) throw new Error("unknown_group_finding");
              return finding.sourceId;
            }))];
            return themeSchema.parse({ ...theme, sourceIds });
          });
          groupRefs.push(stored.id); themeBatches.push(themes);
          checkpoint = { ...checkpoint, substage: "grouping", groupRefs, themeBatches, themesPreview: themes, groupedFindings: Math.min(offset + 100, findings.length) }; checkpointTask(db, task.id, task.attempt_id!, checkpoint);
        } catch (error) {
          if (error instanceof AiPaused || signal.aborted || getRun(db, task.run_id).status !== "running") throw error;
          gap(db, task.run_id, `group:${offset}`, "Theme grouping chunk failed validation; its unavailable evidence is excluded from conclusions");
          groupRefs.push(null); themeBatches.push([]);
          checkpoint = { ...checkpoint, substage: "grouping", groupRefs, themeBatches, groupedFindings: Math.min(offset + 100, findings.length) }; checkpointTask(db, task.id, task.attempt_id!, checkpoint);
        }
      }
      const allThemes = themeBatches.flatMap(themes => themes.map(theme => themeSchema.parse(theme)));
      // The synthesis input is bounded; all original group outputs remain linked
      // in the checkpoint for inspection. Rank by distinct supporting sources.
      const themes = allThemes.sort((a, b) => new Set(b.sourceIds).size - new Set(a.sourceIds).size || a.title.localeCompare(b.title)).slice(0, 30);
      if (allThemes.length > themes.length) gap(db, task.run_id, "theme_limit", "Only the 30 batch themes with most distinct source support entered bounded opportunity synthesis; all batch themes remain linked in checkpoints");
      const settings = researchSettings(decodeObject(getRun(db, task.run_id).settings_json));
      let opportunities: ProposedOpportunity[];
      try {
        const preliminary = await analyze(db, task, "opportunities", { themes, scope: decodeObject(getRun(db, task.run_id).input_json), perspectives: ["missing_capability", "underserved_audience", "poor_execution", ...(settings.crossPlatform ? ["cross_platform"] : [])], direction: settings.direction }, quotes, signal, aiOptions);
        opportunities = preliminary.opportunities.filter(opportunity => opportunity.perspective !== "cross_platform" ? opportunity.direction === null : settings.crossPlatform && opportunity.direction && (settings.direction === "both" || settings.direction === opportunity.direction));
      } catch (error) {
        if (error instanceof AiPaused || signal.aborted || getRun(db, task.run_id).status !== "running") throw error;
        gap(db, task.run_id, "opportunities", "Opportunity synthesis failed validation; source-backed themes are shown as preliminary opportunities");
        opportunities = fallbackOpportunities(themes);
      }
      checkpointTask(db, task.id, task.attempt_id!, json({ ...checkpoint, substage: "provisional_opportunities", themes, opportunities: opportunities.map(o => ({ ...o, status: "Preliminary" })) }));
      return json({ themes, opportunities });
    } catch (error) { if (error instanceof AiPaused || signal.aborted || getRun(db, task.run_id).status !== "running") throw error; gap(db, task.run_id, "grouping", "Theme/opportunity synthesis failed validation"); return { themes: [], opportunities: [] }; }
  };

  const verification = async (task: TaskRow, signal: AbortSignal): Promise<JsonObject> => {
    const run = getRun(db, task.run_id); const settings = researchSettings(decodeObject(run.settings_json)); const input = researchInputSchema.parse(decodeObject(run.input_json));
    if (input.mode === "ideas") return checkIdeaMarkets(task, signal, run, input);
    const opportunities = provisional(db, task.run_id);
    if (!opportunities.length && !discoveryState(db, task.run_id).transfer) return { checks: [], counterparts: [] };
    const selected = discoveryState(db, run.id).selected; let checkpoint = decodeObject(task.checkpoint_json);
    const completed = (checkpoint.completed ?? []) as string[]; const websites = (checkpoint.websites ?? []) as unknown as Array<{ listing: string; official: boolean; result: WebResult }>;
    const counterpartResults = (checkpoint.counterparts ?? []) as unknown as CounterpartCheck[];
    const transferResults = (checkpoint.transfer ?? []) as unknown as TransferCheck[];
    const save = (write?: () => void) => { checkpoint = json({ ...checkpoint, completed, websites, counterparts: counterpartResults, transfer: transferResults }); checkpointTask(db, task.id, task.attempt_id!, checkpoint, write); };
    if (input.mode === "transfer") {
      const target = planLocales("apple", [input.targetCountry!])[0];
      const lookups = () => Number(checkpoint.transferLookups ?? 0);
      for (const candidate of selected.filter(candidate => !candidate.removed)) {
        const key = `transfer:${candidateKey(candidate)}`; if (completed.includes(key)) continue;
        const listing = listingById(db, candidate.sourceId);
        const check: TransferCheck = { source: candidateKey(candidate), targetCountry: target.country, availability: candidate.targetAvailability ?? "unknown", queries: [], sameListingFound: false, regionalVariants: [], alternatives: [], unscreened: [], sameProductSearch: true, needBasedSearch: !!candidate.targetSearchTerms?.length, state: "incomplete", conclusion: "" };
        const details = new Map<string, TargetListing>(); const need: TargetListing[] = [];
        const searches = [{ kind: "same_product", query: `${listing.title} ${listing.developer}`.trim() }, ...(candidate.targetSearchTerms ?? []).slice(0, LIMITS.transferSearchTerms).map(query => ({ kind: "need", query }))];
        for (const search of searches) {
          check.queries.push({ ...search, country: target.country, language: target.language });
          const incomplete = (reason: string) => { if (search.kind === "same_product") check.sameProductSearch = false; else check.needBasedSearch = false; gap(db, run.id, `${key}:${search.kind}`, reason); };
          try {
            for (const result of (await stores[candidate.store].search(search.query, target, signal)).slice(0, LIMITS.transferResults)) {
              const id = candidateKey(result);
              if (id === candidateKey(candidate)) { check.sameListingFound = true; continue; }
              if (!details.has(id)) {
                if (lookups() >= settings.discoveryLimit) { incomplete("Lookup allowance ended before the target-market search was complete"); break; }
                checkpoint.transferLookups = lookups() + 1; save();
                const detail = await stores[candidate.store].details(result.appId, target, signal);
                details.set(id, { id, store: detail.store, appId: detail.appId, title: detail.title, developer: detail.developer, developerId: detail.developerId, url: detail.url, category: detail.category, description: detail.description.slice(0, 1500), rating: detail.rating, ratingTotal: detail.ratingTotal });
              }
              const found = details.get(id)!;
              const sameName = !!listing.title && found.title.trim().toLowerCase() === listing.title.trim().toLowerCase();
              if (found.developerId === listing.developerId || sameName) { if (!check.regionalVariants.some(item => item.id === id)) check.regionalVariants.push(found); }
              else if (search.kind === "need" && !need.some(item => item.id === id)) need.push(found);
            }
          } catch { signal.throwIfAborted(); incomplete("Target-market store search or listing details unavailable"); }
        }
        const pending = need.filter(item => !check.regionalVariants.some(variant => variant.id === item.id));
        if (pending.length && aiOptions.configured !== false) try {
          const scope = { mode: "topic", query: candidate.coreFunctionality ?? `${listing.title}. ${listing.description.slice(0, 300)}`, categories: [], urls: [], websiteUrls: [] };
          const screened = await analyze(db, task, "screening", { scope, candidates: pending.map((item, index) => ({ index, title: item.title, category: item.category, description: item.description, store: item.store, discoveryOrigins: [] })) }, [], signal, aiOptions);
          check.alternatives = screened.candidates.filter(result => result.fit === "core").map(result => pending[result.candidateIndex]);
        } catch (error) {
          if (error instanceof AiPaused || signal.aborted || getRun(db, run.id).status !== "running") throw error;
          check.unscreened = pending; gap(db, run.id, `${key}:screening`, "Target-market alternatives could not be screened for the same job");
        } else check.unscreened = pending;
        const market = target.country;
        [check.state, check.conclusion] = check.sameListingFound ? ["same_listing", `The same listing appeared in a ${market} store search; treat the availability result as unreliable`]
          : check.regionalVariants.length ? ["regional_variant", `A listing with the same name or developer exists in ${market}; it may be a regional variant`]
          : check.alternatives.length ? ["alternatives", `Local alternatives for the same job were found in ${market}`]
          // Only a confirmed missing listing can become an open lead; a manually added app was never checked.
          : check.availability !== "unavailable" ? ["unchecked", `Absence from the ${market} storefront was not confirmed for this app`]
          : !check.sameProductSearch || !check.needBasedSearch ? ["incomplete", "Target-market search incomplete"]
          : check.unscreened.length ? ["unscreened", "Possible alternatives found; not screened for the same job"]
          : ["open", "No suitable alternative found in this research"];
        // Listing text is only needed for screening; the checkpoint keeps the identifying facts.
        for (const list of [check.regionalVariants, check.alternatives, check.unscreened]) list.forEach(item => { item.description = item.description.slice(0, 300); });
        transferResults.push(check); completed.push(key); save();
      }
      if (!opportunities.length) return json({ checks: [], counterparts: [], transfer: transferResults });
    }
    for (const candidate of selected) {
      const listing = listingById(db, candidate.sourceId); const key = `website:${candidateKey(candidate)}`;
      if (completed.includes(key)) continue;
      if (listing.website) {
        const result = await website(listing.website, signal); websites.push({ listing: candidateKey(candidate), official: true, result: { ...result, pages: result.pages.map(page => ({ ...page, text: "" })) } });
        save(() => { for (const page of result.pages) saveSource(db, run.id, task.id, "website-v1", { kind: "website", url: page.url, locale: "", payload: json(page), capturedAt: page.capturedAt }, { officialListingSourceId: candidate.sourceId }); });
        for (const failure of result.failures) gap(db, run.id, failure.url, failure.reason);
      } else gap(db, run.id, key, "Not verified: listing has no official website");
      completed.push(key); save();
    }
    for (const url of input.websiteUrls) {
      const key = `website:user:${url}`; if (completed.includes(key)) continue;
      const result = await website(url, signal); websites.push({ listing: "user", official: false, result: { ...result, pages: result.pages.map(page => ({ ...page, text: "" })) } });
      save(() => { for (const page of result.pages) saveSource(db, run.id, task.id, "website-v1", { kind: "website", url: page.url, locale: "", payload: json(page), capturedAt: page.capturedAt }, { userSupplied: true, official: false }); });
      for (const failure of result.failures) gap(db, run.id, failure.url, failure.reason);
      completed.push(key); save();
    }
    if (settings.crossPlatform) for (const candidate of selected) {
      const destination: Store = candidate.store === "apple" ? "google" : "apple";
      const direction = candidate.store === "apple" ? "ios_to_android" : "android_to_ios";
      if (settings.direction !== "both" && settings.direction !== direction) continue;
      const key = `counterpart:${candidateKey(candidate)}`; if (completed.includes(key)) continue;
      const listing = listingById(db, candidate.sourceId);
      const pages = websites.filter(site => site.listing === candidateKey(candidate) && site.official).flatMap(site => site.result.pages).map(page => {
        const source = sourcesForRun(db, run.id, "website").find(source => source.url === page.url);
        return source ? { ...page, text: String(decodeObject(source.payload_json).text) } : page;
      });
      const check: CounterpartCheck = { source: candidateKey(candidate), destination, state: "not_found", queries: [], candidates: [], alternativeCandidates: [], unavailableMarkets: [], sameProductSearch: true, needBasedSearch: true, verifiedSourceUrl: null, verifiedDestinationId: null, conclusion: "Not verified", feasibility: "Not verified" };
      const lookedUp = new Set(sourcesForRun(db, run.id, "listing").map(source => `${source.store}:${source.app_id}`));
      const discoveryLookups = discoveryState(db, run.id).lookups;
      const lookupCount = () => discoveryLookups + Number(checkpoint.metadataLookups ?? 0);
      const searches = [{ kind: "same_product", query: `${listing.title} ${listing.developer}` }, { kind: "need", query: input.query || input.categories.map(c => c.label).join(" ") || listing.category || listing.title }];
      for (const search of searches) for (const country of settings.countries) {
        const locale = planLocales(destination, [country])[0]; check.queries.push({ ...search, country, language: locale.language });
        if (lookupCount() >= PRESETS[settings.preset].metadataLookups) { check.sameProductSearch = false; check.needBasedSearch = false; gap(db, run.id, key, "Metadata limit prevented complete counterpart/alternative checks"); break; }
        try {
          const found = await stores[destination].search(search.query, locale, signal);
          for (const result of found.slice(0, LIMITS.searchResults)) {
            const id = candidateKey(result); if (lookupCount() >= PRESETS[settings.preset].metadataLookups && !lookedUp.has(id)) { check.sameProductSearch = false; check.needBasedSearch = false; gap(db, run.id, key, "Metadata limit prevented complete counterpart/alternative checks"); break; }
            if (!lookedUp.has(id)) {
              checkpoint.metadataLookups = Number(checkpoint.metadataLookups ?? 0) + 1; save();
              const detail = await stores[destination].details(result.appId, locale, signal); lookedUp.add(id);
              checkpointTask(db, task.id, task.attempt_id!, checkpoint, () => persistSnapshot(db, task, "listing", detail));
            }
            const detail = sourcesForRun(db, run.id, "listing").find(row => row.store === destination && row.app_id === result.appId);
            const listingResult = detail ? decodeObject(detail.payload_json) as unknown as Listing : result;
            if (search.kind === "same_product") check.candidates.push(id);
            else if (relevance(listingResult, search.query, false).relevance !== "unrelated") check.alternativeCandidates.push(id);
          }
        } catch { signal.throwIfAborted(); check.unavailableMarkets.push(`${destination}:${country}:${search.kind}`); gap(db, run.id, `${key}:${country}:${search.kind}`, "Destination store search or candidate details unavailable"); if (search.kind === "same_product") check.sameProductSearch = false; else check.needBasedSearch = false; }
      }
      check.candidates = [...new Set(check.candidates)]; check.alternativeCandidates = [...new Set(check.alternativeCandidates)];
      const match = verifiedCounterpart(listing, pages, check.candidates);
      const verifiedSource = match ? sourcesForRun(db, run.id, "website").find(source => source.url === match.url && source.provenance_json && decodeObject(source.provenance_json).officialListingSourceId === candidate.sourceId) : null;
      check.state = match && verifiedSource ? "verified" : check.candidates.length ? "potential" : "not_found";
      check.verifiedSourceUrl = verifiedSource?.url ?? null; check.verifiedDestinationId = verifiedSource ? match!.destinationId : null;
      check.verifiedSource = verifiedSource ? { sourceId: verifiedSource.id, sourceKind: "website", sourceUrl: verifiedSource.url, provenance: "official_website" } : null;
      check.conclusion = check.needBasedSearch && !check.alternativeCandidates.length ? "No suitable alternative found in this research" : check.alternativeCandidates.length ? "Potential need-based alternatives found; suitability requires investigation" : "Alternative search incomplete";
      counterpartResults.push(check); completed.push(key); save();
    }
    const sources = sourcesForRun(db, run.id); const quotes = sourceQuotes(sources);
    try {
      const checks = await analyze(db, task, "verification", { opportunities, counterparts: counterpartResults, sources: quotes.map(source => ({ ...source, text: source.text.slice(0, 8000) })) }, quotes, signal, aiOptions);
      const keys = new Set(opportunities.map(o => o.key));
      return json({ checks: checks.checks.filter(check => keys.has(check.key)), counterparts: counterpartResults, transfer: transferResults });
    } catch (error) { if (error instanceof AiPaused || signal.aborted || getRun(db, run.id).status !== "running") throw error; gap(db, run.id, "verification", "Competitor claims could not be validated"); return json({ checks: [], counterparts: counterpartResults, transfer: transferResults }); }
  };

  const report = async (task: TaskRow, signal: AbortSignal): Promise<JsonObject> => {
    const run = getRun(db, task.run_id); const proposed = provisional(db, run.id); const selected = sourcesForRun(db, run.id, "review", true);
    const findings = allFindings(db, run.id); const analyzedIds = successfullyAnalyzedSourceIds(db, run.id);
    const checksResult = runTasks(db, run.id).find(t => t.stage === "verification" && t.result_json)?.result_json;
    const verificationData = checksResult ? decodeObject(checksResult) : { checks: [], counterparts: [] };
    const checks = schemas.verification.parse({ checks: verificationData.checks }).checks;
    const counterparts = verificationData.counterparts as unknown as CounterpartCheck[];
    const rows = sourcesForRun(db, run.id); const quotes = sourceQuotes(rows);
    const discovery = discoveryState(db, run.id);
    const cohort = discovery.selected.filter(candidate => !candidate.removed);
    let marketOverview: JsonObject | null = null;
    const transferChecks = (Array.isArray(verificationData.transfer) ? verificationData.transfer : []) as unknown as TransferCheck[];
    const order = ["open", "unscreened", "incomplete", "not_searched", "unchecked", "alternatives", "regional_variant", "same_listing"];
    // Every transferable gap is listed; the target-market search ran only for the selected ones.
    const removed = new Set(discovery.selected.filter(candidate => candidate.removed).map(candidateKey));
    const surveyed = !discovery.transfer ? [] : transferLeadRows(db, run.id, LIMITS.transferLeads + removed.size).filter(row => !removed.has(`${row.store}:${row.app_id}`));
    const surveyedKeys = new Set(surveyed.map(row => `${row.store}:${row.app_id}`));
    const transferPool = !discovery.transfer ? [] : [
      ...surveyed.map(row => ({ key: `${row.store}:${row.app_id}`, store: row.store, appId: row.app_id, sourceId: row.source_id, verdict: transferVerdict.safeParse(row.assessment_json ? decodeObject(row.assessment_json) : null).data, availability: "unavailable" as TargetAvailability, checkedAt: row.checked_at })),
      // Apps added by hand during review were never checked against the target storefront.
      ...cohort.filter(candidate => !surveyedKeys.has(candidateKey(candidate))).map(candidate => ({ key: candidateKey(candidate), store: candidate.store, appId: candidate.appId, sourceId: candidate.sourceId, verdict: undefined, availability: candidate.targetAvailability ?? "unknown" as TargetAvailability, checkedAt: candidate.targetCheckedAt ?? null })),
    ];
    const transferFound = !discovery.transfer ? 0 : db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM transfer_listings WHERE run_id=? AND fit IN ('transferable','unscreened')").get(run.id)!.n;
    const transferLeads = transferPool.map(lead => {
      const listing = listingById(db, lead.sourceId); const check = transferChecks.find(check => check.source === lead.key) ?? null;
      return { key: lead.key, store: lead.store, appId: lead.appId, sourceId: lead.sourceId, title: listing.title, developer: listing.developer, url: listing.url, category: listing.category, rating: listing.rating, ratingTotal: listing.ratingTotal, released: listing.released ?? null,
        coreFunctionality: lead.verdict?.coreFunctionality.slice(0, 300) ?? null, fit: lead.verdict?.fit ?? null, barriers: (lead.verdict?.barriers ?? []).slice(0, 3).map(item => item.slice(0, 300)), reason: (lead.verdict?.reason ?? "Not screened.").slice(0, 300), availability: lead.availability, availabilityCheckedAt: lead.checkedAt ?? null, state: check?.state ?? "not_searched", check };
    }).sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || (b.ratingTotal ?? 0) - (a.ratingTotal ?? 0) || a.key.localeCompare(b.key)).slice(0, LIMITS.transferLeads);
    if (transferFound > transferLeads.length) gap(db, run.id, "transfer_lead_limit", "More transfer leads were found than the report lists; the rest remain in the survey table");
    // Transfer leads are unrelated products, so a single combined landscape would mislead.
    if (cohort.length && !discovery.transfer && aiOptions.configured !== false) try {
      const listingRows = cohort.map(candidate => sourceById(db, candidate.sourceId));
      const candidates = cohort.map((candidate, index) => {
        const listing = listingById(db, candidate.sourceId);
        return { index, title: listing.title, category: listing.category ?? null, coreFunctionality: candidate.coreFunctionality ?? null, description: listing.description.slice(0, 1500) };
      });
      const market = await analyze(db, task, "market", { scope: discovery.exploration ?? decodeObject(run.input_json), candidates }, sourceQuotes(listingRows), signal, aiOptions);
      const capabilities = (items: typeof market.commonCapabilities) => items.map(({ listingIndexes, ...item }) => ({ ...item, sourceIds: [...new Set(listingIndexes.map(index => cohort[index]?.sourceId).filter((sourceId): sourceId is string => !!sourceId))] }));
      marketOverview = json({ ...market, commonCapabilities: capabilities(market.commonCapabilities), specializedCapabilities: capabilities(market.specializedCapabilities), appCount: cohort.length });
    } catch (error) {
      if (error instanceof AiPaused || signal.aborted || getRun(db, run.id).status !== "running") throw error;
      gap(db, run.id, "market_overview", "Combined app functionality summary failed validation");
    }
    const assembled = proposed.map(opportunity => assembleOpportunity(opportunity, selected, findings, checks, counterparts, rows, now(), analyzedIds));
    let synthesis: JsonObject = { summary: proposed.length ? "Opportunities assembled from validated evidence." : selected.length ? "No source-backed opportunities could be established. Try a more specific need or additional stores/languages." : "No trusted review evidence was available. Inspect app selection and identity/collection coverage before retrying.", recommendations: [], limitations: [] };
    const markets = (Array.isArray(verificationData.markets) ? verificationData.markets : []) as unknown as IdeaMarket[];
    const verdicts = ["none_reported", "equivalent_unconfirmed", "not_researched", "reported_present", "equivalent_confirmed"];
    const ideaLeads = (discovery.ideas ?? []).map(idea => {
      const urlOf = new Map(idea.pages.map(page => [page.sourceId, page.url]));
      const profile = idea.profile ? { ...idea.profile, evidence: (idea.profile.evidence as JsonObject[]).map(item => ({ ...item, url: urlOf.get(String(item.sourceId)) ?? null })) } : null;
      return { id: idea.id, name: idea.name, summary: idea.summary, officialUrl: idea.officialUrl, status: idea.status, pages: idea.pages, failures: idea.failures, profile, market: markets.find(market => market.id === idea.id) ?? null };
    }).sort((a, b) => verdicts.indexOf(a.market?.verdict ?? "not_researched") - verdicts.indexOf(b.market?.verdict ?? "not_researched") || a.id.localeCompare(b.id, "en", { numeric: true }));
    const runInput = decodeObject(run.input_json);
    if (discovery.ideas) synthesis.summary = "Business ideas from your pasted research were read from their sources. Statements without a quoted source remain unverified claims.";
    if (transferLeads.length && !proposed.length) synthesis.summary = "Apps not found in the target storefront are listed as transfer leads. No review-backed app concepts could be established from this sample.";
    if (task.kind === "no_matching_apps") synthesis.summary = "No matching apps were found. Adjust the need, selected stores or countries and try again.";
    if (assembled.length) try {
      synthesis = json(await analyze(db, task, "report", { opportunities: assembled, exploration: discovery.exploration ?? null, marketOverview, coverage: decodeObject(getRun(db, run.id).coverage_json), sources: quotes.filter(source => analyzedIds.has(source.id)) }, quotes, signal, aiOptions));
    } catch (error) { if (error instanceof AiPaused || signal.aborted || getRun(db, run.id).status !== "running") throw error; gap(db, run.id, "report_synthesis", "Report prose synthesis failed; validated evidence and code-computed assessment retained"); }
    const summary = json({ ...synthesis, exploration: discovery.exploration ?? null, ideas: discovery.ideas ? { sourceCountry: runInput.sourceCountry, targetCountry: runInput.targetCountry, researched: Array.isArray(runInput.targetFindings), leads: ideaLeads } : null, transfer: discovery.transfer ? { ...discovery.transfer, listed: transferLeads.length, found: Math.max(transferFound, transferLeads.length), leads: transferLeads } : null, marketOverview, opportunities: assembled, counts: { collected: rows.filter(row => row.kind === "review").length, trustedUnique: new Set(rows.filter(row => row.kind === "review" && row.logical_review_key).map(row => row.logical_review_key)).size, selected: selected.length, analyzed: analyzedIds.size }, coverage: decodeObject(getRun(db, run.id).coverage_json), status: getRun(db, run.id).coverage === "gaps" ? "Completed with gaps" : "Completed", sampling: "Purposive sample; counts describe analyzed source reviews, not all users or distinct people.", noMatchingApps: task.kind === "no_matching_apps" });
    checkpointTask(db, task.id, task.attempt_id!, { ready: true }, () => {
      for (const opportunity of assembled) db.query("INSERT INTO opportunities(id,run_id,report_key,title,priority,confidence,report_json,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(run_id,report_key) DO NOTHING").run(randomUUID(), run.id, opportunity.key, opportunity.title, opportunity.priority, opportunity.confidence, encodeJson(opportunity), now());
    });
    return summary;
  };

  const planner: StagePlanner = (run, stage) => {
    if (stage === "collection") {
      const selected = discoveryState(db, run.id).selected.filter(c => !c.removed); const settings = researchSettings(decodeObject(run.settings_json));
      const quotas = equalShares(settings.reviewLimit, selected.length);
      // Transfer is a listing survey; it never collects reviews.
      if (!selected.length || !settings.reviewLimit || decodeObject(run.input_json).mode === "transfer") return [{ key: "no_reviews", kind: "no_reviews", checkpoint: emptyCollection(now()) }];
      return selected.flatMap((candidate, index) => {
        const locales = planLocales(candidate.store, settings.countries, settings.languages as string[]); const streamQuotas = equalShares(quotas[index], locales.length);
        return locales.map((locale, streamIndex) => ({ key: `${candidateKey(candidate)}:${locale.country}:${locale.language}`, kind: "review_stream", checkpoint: json({ ...emptyCollection(now()), store: candidate.store, appId: candidate.appId, ...locale, appQuota: quotas[index], quota: streamQuotas[streamIndex], appIndex: index, streamIndex, scopeHash: hash({ store: candidate.store, appId: candidate.appId, ...locale, sort: "newest", policy: POLICY_VERSION, collector: COLLECTOR_VERSION }) }) }));
      });
    }
    if (stage === "analysis") {
      selectCollectedReviews(db, run, now()); const selected = sourcesForRun(db, run.id, "review", true);
      if (!selected.length) return [{ key: "empty", checkpoint: { sourceId: null } }];
      return selected.map(row => ({ key: `review:${row.id}`, checkpoint: { sourceId: row.id } }));
    }
    return [{ key: stage }];
  };
  return { handlers: { discovery: discover, collection: collect, analysis, grouping, verification, report }, planner };
}

interface TransferLeadRow { store: Store; app_id: string; category: string; chart: string; rank: number; checked_at: number | null; source_id: string; fit: string; assessment_json: string | null; payload_json: string }
// Leads of a survey: missing from the target storefront and not tied to the source market, most-rated first.
function transferLeadRows(db: DB, runId: string, limit: number): TransferLeadRow[] {
  return db.query<TransferLeadRow, [string, number]>("SELECT t.store,t.app_id,t.category,t.chart,t.rank,t.checked_at,t.source_id,t.fit,t.assessment_json,s.payload_json FROM transfer_listings t JOIN sources s ON s.id=t.source_id WHERE t.run_id=? AND t.fit IN ('transferable','unscreened') ORDER BY t.fit='transferable' DESC, COALESCE(json_extract(s.payload_json,'$.ratingTotal'),0) DESC, t.rank, t.store, t.app_id LIMIT ?").all(runId, limit);
}
function emptyCollection(now: number): JsonObject { return { version: randomUUID(), scopeHash: "empty", startedAt: now, endedAt: null, quota: 0, uniqueCount: 0, pages: 0, requestAttempts: 0, noNewIdPages: 0, cursor: null, seenCursors: [], stopReason: null, complete: false }; }
function fallbackOpportunities(themes: Array<{ title: string; need: string; sourceIds: string[]; audience: string | null; audienceInferred: boolean; uncertainty: string[] }>): ProposedOpportunity[] {
  return themes.map(theme => ({ key: `theme-${hash({ title: theme.title, sourceIds: theme.sourceIds })}`, title: theme.title, need: theme.need, audience: theme.audience, audienceInferred: theme.audienceInferred, perspective: "poor_execution", direction: null, sourceIds: theme.sourceIds, counterSourceIds: [], impact: "moderate", concept: theme.need, coreFeatures: [theme.need, "Validate the workflow with the represented audience"], differentiators: ["Execute the evidenced core workflow more reliably than the reviewed cohort"], executionPriorities: ["Resolve the source-backed need before expanding scope"], competitorPattern: theme.title, uncertainty: ["Preliminary concept assembled from source-backed themes after concept synthesis failed validation.", ...theme.uncertainty] }));
}
function allFindings(db: DB, runId: string): Finding[] {
  return runTasks(db, runId).filter(task => task.stage === "analysis" && task.result_json).flatMap(task => {
    const findings = decodeObject(task.result_json!).findings ?? [];
    return Array.isArray(findings) ? findings.map(finding => findingSchema.parse(finding)) : [];
  });
}
export function successfullyAnalyzedSourceIds(db: DB, runId: string): Set<string> {
  return new Set(runTasks(db, runId).filter(task => task.stage === "analysis" && task.status === "completed" && task.result_json && decodeObject(task.result_json).failed !== true).flatMap(task => {
    const sourceId = decodeObject(task.checkpoint_json).sourceId;
    return typeof sourceId === "string" ? [sourceId] : [];
  }));
}
function provisional(db: DB, runId: string): ProposedOpportunity[] {
  const task = runTasks(db, runId).find(task => task.stage === "grouping" && task.result_json);
  return task ? schemas.opportunities.parse({ opportunities: decodeObject(task.result_json!).opportunities ?? [] }).opportunities : [];
}
function selectCollectedReviews(db: DB, run: RunRow, now: number): void {
  const candidates = discoveryState(db, run.id).selected; const settings = researchSettings(decodeObject(run.settings_json)); const rows = sourcesForRun(db, run.id, "review");
  const freshTasks = new Set(runTasks(db, run.id).filter(task => task.stage === "collection" && task.status !== "superseded" && now - parseCollectionCheckpoint(task.checkpoint_json).startedAt < FRESHNESS.collectionMs).map(task => task.id));
  for (const task of runTasks(db, run.id).filter(task => task.kind === "review_stream" && task.status !== "superseded")) {
    const checkpoint = decodeObject(task.checkpoint_json);
    if (!checkpoint.pages && !checkpoint.reusedTaskId) gap(db, run.id, task.dedupe_key, "Planned stream was not visited or successfully reused");
  }
  rows.sort((a, b) => Number(freshTasks.has(b.task_id!)) - Number(freshTasks.has(a.task_id!)) || b.captured_at - a.captured_at || a.id.localeCompare(b.id));
  const byApp = candidates.map(candidate => rows.filter(row => row.store === candidate.store && row.app_id === candidate.appId && row.logical_review_key));
  const quotas = allocateReviews(settings.reviewLimit, byApp.map(rows => new Set(rows.map(row => row.logical_review_key)).size));
  const originalQuotas = equalShares(settings.reviewLimit, candidates.length);
  db.query("UPDATE run_sources SET selected=0,provenance_json=json_remove(provenance_json,'$.poolEligible') WHERE run_id=?").run(run.id);
  byApp.forEach((appRows, index) => {
    const candidate = candidates[index]; const streams = planLocales(candidate.store, settings.countries, settings.languages as string[]);
    const owned = new Set<string>();
    const perStream = streams.map(locale => appRows.filter(row => {
      if (owned.has(row.logical_review_key!)) return false;
      const p = decodeObject(row.payload_json); if (p.country !== locale.country || p.language !== locale.language) return false;
      owned.add(row.logical_review_key!); return true;
    }));
    const streamQuotas = allocateReviews(quotas[index], perStream.map(rows => rows.length), false);
    // Whole pages may be retained as observations. Only a bounded, evenly
    // allocated pool participates in sampling; one large first page cannot
    // consume another locale's allowance. Empty shares redistribute in code.
    const poolQuotas = allocateReviews(Math.min(quotas[index] * LIMITS.poolMultiplier, originalQuotas[index] * LIMITS.poolMultiplier), perStream.map(rows => rows.length), false);
    perStream.forEach((streamRows, streamIndex) => {
      const newestRows = [...streamRows].sort((a, b) => {
        const dateA = Date.parse(String(decodeObject(a.payload_json).date)); const dateB = Date.parse(String(decodeObject(b.payload_json).date));
        return (Number.isFinite(dateB) ? dateB : 0) - (Number.isFinite(dateA) ? dateA : 0) || a.id.localeCompare(b.id);
      });
      const pool = newestRows.slice(0, poolQuotas[streamIndex]);
      for (const row of pool) db.query("UPDATE run_sources SET provenance_json=json_set(provenance_json,'$.poolEligible',json('true')) WHERE run_id=? AND source_id=? AND task_id=?").run(run.id, row.id, row.task_id!);
      const sample = sampleReviews(pool.map(row => { const p = decodeObject(row.payload_json); return { id: row.id, rating: Number(p.rating), date: typeof p.date === "string" ? p.date : null }; }), streamQuotas[streamIndex], now);
      for (const item of sample) {
        const row = streamRows.find(row => row.id === item.id)!;
        db.query("UPDATE run_sources SET counted=0,selected=0 WHERE run_id=? AND logical_review_key=?").run(run.id, row.logical_review_key!);
        const provenance = row.provenance_json ? decodeObject(row.provenance_json) : {};
        const stale = !freshTasks.has(row.task_id!);
        db.query("UPDATE run_sources SET counted=1,selected=1,provenance_json=? WHERE run_id=? AND source_id=? AND task_id=?").run(encodeJson({ ...provenance, poolEligible: true, sample: item.sample, age: item.age, freshness: stale ? "stale" : "fresh" }), run.id, row.id, row.task_id!);
        if (stale) gap(db, run.id, `stale:${candidateKey(candidate)}`, "Retained older evidence after an incomplete replacement; original source and observation dates remain visible");
      }
    });
  });
}
export interface CounterpartCheck {
  source: string; destination: Store; state: "potential" | "verified" | "not_found";
  queries: { kind: string; query: string; country: string; language: string }[];
  candidates: string[]; alternativeCandidates: string[]; unavailableMarkets: string[];
  sameProductSearch: boolean; needBasedSearch: boolean; verifiedSourceUrl: string | null; verifiedDestinationId: string | null; conclusion: string; feasibility: "Not verified";
  verifiedSource?: { sourceId: string; sourceKind: "website"; sourceUrl: string; provenance: "official_website" } | null;
}
export interface TargetListing { id: string; store: Store; appId: string; title: string; developer: string; developerId: string; url: string; category: string | null; description: string; rating: number | null; ratingTotal: number | null }
export interface TransferCheck {
  source: string; targetCountry: string; availability: TargetAvailability;
  queries: { kind: string; query: string; country: string; language: string }[];
  sameListingFound: boolean; regionalVariants: TargetListing[]; alternatives: TargetListing[]; unscreened: TargetListing[];
  sameProductSearch: boolean; needBasedSearch: boolean;
  state: "open" | "unscreened" | "incomplete" | "unchecked" | "alternatives" | "regional_variant" | "same_listing"; conclusion: string;
}
export function verifiedCounterpart(listing: Listing, pages: WebResult["pages"], candidateIds: string[]): { url: string; destinationId: string } | null {
  for (const page of pages) {
    const links = (page as typeof page & { storeLinks?: string[] }).storeLinks ?? page.links;
    const ids = links.flatMap(link => { try { const reference = parseStoreUrl(link); return [candidateKey(reference)]; } catch { return []; } });
    // A company portfolio linking many products is not a product-specific pair.
    if (new Set(ids).size !== 2 || !ids.includes(candidateKey(listing)) || !listing.title || !page.text.toLowerCase().includes(listing.title.toLowerCase())) continue;
    const destinationId = ids.find(id => !id.startsWith(`${listing.store}:`) && candidateIds.includes(id));
    if (destinationId) return { url: page.url, destinationId };
  }
  return null;
}
export function assembleOpportunity(opportunity: ProposedOpportunity, selected: SourceRow[], findings: Finding[], checks: ReturnType<typeof schemas.verification.parse>["checks"], counterparts: CounterpartCheck[], rows: SourceRow[], now: number, analyzedIds: ReadonlySet<string>) {
  const ids = new Set(opportunity.sourceIds); const support = selected.filter(row => ids.has(row.id) && analyzedIds.has(row.id));
  let check = checks.find(check => check.key === opportunity.key);
  if (check) try {
    const catalog = sourceQuotes(rows); validateCitations({ checks: [check] }, catalog);
    validateStageLinks("verification", { checks: [check] }, { opportunities: [opportunity], sources: catalog });
  } catch { check = undefined; }
  const cross = opportunity.perspective === "cross_platform";
  const relevantCounterparts = counterparts.filter(check => support.some(row => `${row.store}:${row.app_id}` === check.source));
  const evidence = support.map(row => {
    const listingSource = rows.find(source => source.kind === "listing" && source.store === row.store && source.app_id === row.app_id);
    const listing = listingSource ? decodeObject(listingSource.payload_json) : {};
    const pair = counterparts.find(pair => pair.state === "verified" && (pair.source === `${row.store}:${row.app_id}` || pair.verifiedDestinationId === `${row.store}:${row.app_id}`));
    const payload = decodeObject(row.payload_json);
    const productId = pair ? [pair.source, pair.verifiedDestinationId].sort().join("=") : `${row.store}:${row.app_id}`;
    return { reviewId: row.logical_review_key!, productId, developerId: String(listing.developerId ?? "unknown"), date: typeof payload.date === "string" ? payload.date : null };
  });
  const assessment = evidenceConfidence({ support: evidence, validCitations: support.length === new Set(opportunity.sourceIds).size, checksCompleted: !!check && check.outcome !== "uncertain" && check.citations.length > 0, materialContradiction: check?.outcome === "contradicted", identityUncertain: support.length < ids.size || evidence.some(item => item.developerId.includes("unknown")), missingSourceDependency: !check || !check.citations.length || support.some(row => row.provenance_json && decodeObject(row.provenance_json).freshness === "stale"), provisional: false,
    ...(cross ? { crossPlatform: { sameProductSearch: relevantCounterparts.length > 0 && relevantCounterparts.every(check => check.sameProductSearch), needBasedSearch: relevantCounterparts.length > 0 && relevantCounterparts.every(check => check.needBasedSearch), feasibilityUnresolved: true } } : {}),
  }, now);
  const priority = check?.outcome === "contradicted" ? 3 : assessment.confidence === "high" && opportunity.impact === "severe" ? 1 : assessment.confidence === "medium" || assessment.counts.supportingReviews >= 3 ? 2 : 3;
  return { ...opportunity, ...assessment, priority, status: check?.outcome === "contradicted" ? "Contradicted" : check ? "Checked" : "Partially verified", priorityReasons: [`${assessment.counts.supportingReviews} distinct supporting source reviews`, `${assessment.counts.developers} recorded developer identities`, `Reported impact: ${opportunity.impact}`, `Competitor check: ${check?.outcome ?? "Not verified"}`], evidence: findings.filter(finding => ids.has(finding.sourceId) && analyzedIds.has(finding.sourceId)), verification: check ?? null, counterparts: relevantCounterparts, denominator: analyzedIds.size, sampleCounts: { collected: rows.filter(row => row.kind === "review").length, selected: selected.length, analyzed: analyzedIds.size }, sampleStatement: "Support within the successfully analyzed sample; not population prevalence or predicted commercial success" };
}
