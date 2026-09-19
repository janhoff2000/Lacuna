// Ordinary server functions shared by React Router loaders/actions. Never return secrets.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decodeObject, encodeJson, type JsonObject } from "../shared/types";
import { getSetting, setSetting, transaction, type DB } from "./db";
import { apiConfigured, budgetState, DEFAULT_MODEL, MODEL_CATALOG } from "./ai";
import { appleAdapter } from "./collectors/apple";
import { googleAdapter } from "./collectors/google";
import { parseStoreUrl, type StoreAdapter } from "./collectors/common";
import { discoveryState, runTasks, sourcesForRun, successfullyAnalyzedSourceIds, type CandidateRecord } from "./research";
import { createRun, getRun, pauseRun, cancelRun, resumeRun, workerStatus, type RunRow } from "./runs";
import { defaultResearchSettings, researchInputSchema, researchSettings } from "./research-input";
import { saveSource } from "./sources";
import { PRESETS } from "./policy";

// Stable for this web process, including development module reloads. A new
// process gets a new identity; no timer or lease can expire a live reservation.
const candidateProcessState = globalThis as typeof globalThis & { __lacunaWebProcessInstanceId?: string };
const WEB_PROCESS_INSTANCE_ID = candidateProcessState.__lacunaWebProcessInstanceId ??= randomUUID();

export function requireSameOrigin(request: Request): void {
  if (request.method !== "POST") throw new Response("Mutations require POST", { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new Response("Cross-origin mutation rejected", { status: 403 });
}
export function createResearch(db: DB, input: unknown, settings: unknown, budgetUsd?: number): string {
  const parsedInput = researchInputSchema.parse(input); const parsedSettings = researchSettings(settings);
  const includes = new Set(parsedInput.urls.map(url => { const reference = parseStoreUrl(url); return `${reference.store}:${reference.appId}`; }));
  if (includes.size > parsedSettings.appLimit) throw new Error("Explicit inclusions exceed the listing limit");
  return createRun(db, JSON.parse(encodeJson(parsedInput)), parsedSettings, budgetUsd);
}
export function listResearch(db: DB) { return db.query<RunRow,[]>("SELECT * FROM runs ORDER BY created_at DESC,id DESC LIMIT 200").all().map(row => ({ ...row, input: decodeObject(row.input_json), settings: decodeObject(row.settings_json), budget: budgetState(db, row.id) })); }
export function readResearch(db: DB, runId: string) {
  const run = getRun(db, runId); const tasks = runTasks(db, runId);
  const opportunities: Array<JsonObject & { id: string }> = db.query<{ id: string; report_json: string }, [string]>("SELECT id,report_json FROM opportunities WHERE run_id=? ORDER BY priority,created_at,id").all(runId).map(row => ({ id: row.id, ...decodeObject(row.report_json) }));
  const savedOpportunityIds = db.query<{ opportunity_id: string }, [string]>("SELECT saved.opportunity_id FROM saved_opportunities saved JOIN opportunities opportunity ON opportunity.id=saved.opportunity_id WHERE opportunity.run_id=?").all(runId).map(row => row.opportunity_id);
  const reportTask = tasks.find(task => task.stage === "report" && task.result_json);
  const state = discoveryState(db, runId);
  return { run: { ...run, input: decodeObject(run.input_json), settings: decodeObject(run.settings_json), coverageDetails: decodeObject(run.coverage_json) },
    candidates: state.candidates.map(candidate => ({ ...candidate, listing: candidate.sourceId ? decodeObject(db.query<{ payload_json: string }, [string]>("SELECT payload_json FROM sources WHERE id=?").get(candidate.sourceId)!.payload_json) : null })),
    selected: state.selected, tasks: tasks.map(task => ({ ...task, checkpoint: decodeObject(task.checkpoint_json), result: task.result_json ? decodeObject(task.result_json) : null })),
    opportunities, savedOpportunityIds, sources: sourcesForRun(db, runId).map(row => ({ ...row, payload: decodeObject(row.payload_json) })), report: reportTask ? decodeObject(reportTask.result_json!) : null, budget: budgetState(db, runId), worker: workerStatus(db) };
}
export function researchProgress(db: DB, runId: string) {
  const run = getRun(db, runId); const tasks = runTasks(db, runId); const worker = workerStatus(db);
  const counts = db.query<{ collected: number; selected: number; trusted: number }, [string]>("SELECT COUNT(DISTINCT s.id) AS collected,COALESCE(SUM(rs.selected),0) AS selected,COALESCE(SUM(rs.counted),0) AS trusted FROM run_sources rs JOIN sources s ON s.id=rs.source_id WHERE rs.run_id=? AND s.kind='review'").get(runId)!;
  const analyzed = successfullyAnalyzedSourceIds(db, runId).size;
  const configuration = tasks.some(task => task.error_code === "configuration");
  const discovery = discoveryState(db, runId);
  return { id: run.id, status: run.status, reason: run.reason, stage: run.stage, coverage: run.coverage, coverageDetails: decodeObject(run.coverage_json), counts: { ...counts, analyzed }, completedTasks: tasks.filter(t => t.status === "completed").length, totalTasks: tasks.length, candidates: discovery.selected.length ? discovery.selected : discovery.candidates, preliminary: tasks.filter(t => t.stage === "grouping").map(t => t.result_json ? decodeObject(t.result_json) : decodeObject(t.checkpoint_json)), budget: budgetState(db, runId), worker,
    message: run.status === "queued" && worker !== "running" ? "Queued — worker not running. Start with bun run worker." : run.status === "paused" && configuration ? "Configure OPENAI_API_KEY in the local ignored .env file, then Resume." : run.status === "paused" && run.reason === "budget" ? "Paused for budget or uncertain provider cost. Inspect spending before resuming." : run.status === "paused" && run.reason === "app_review" ? "Review the selected apps, then Continue." : run.status === "completed" && run.coverage === "gaps" ? "Completed with gaps" : run.status };
}
export function readSettings(db: DB) {
  const saved = getSetting(db, "preferences");
  if (!saved) {
    const defaults = defaultResearchSettings();
    return { appearance: "dark", defaults, spokenLanguages: defaults.spokenLanguages, model: DEFAULT_MODEL, configured: apiConfigured(), models: Object.keys(MODEL_CATALOG), modelCatalog: MODEL_CATALOG, setup: "Set OPENAI_API_KEY in the ignored local .env file and restart the worker." };
  }
  const preferences = z.object({ appearance: z.enum(["system", "light", "dark"]), defaults: z.unknown(), spokenLanguages: z.array(z.string()).min(1).max(20), model: z.string().trim().min(1).max(100) }).strict().parse(saved);
  const defaults = researchSettings(preferences.defaults);
  return { ...preferences, defaults, spokenLanguages: defaults.spokenLanguages, configured: apiConfigured(), models: Object.keys(MODEL_CATALOG), modelCatalog: MODEL_CATALOG, setup: "Set OPENAI_API_KEY in the ignored local .env file and restart the worker." };
}
export function updateSettings(db: DB, value: unknown): void {
  const settings = z.object({ appearance: z.enum(["system", "light", "dark"]), defaults: z.unknown(), spokenLanguages: z.array(z.string()).min(1).max(20), model: z.string().trim().min(1).max(100) }).strict().parse(value);
  const defaults = researchSettings({ ...researchSettings(settings.defaults), spokenLanguages: settings.spokenLanguages });
  setSetting(db, "preferences", { appearance: settings.appearance, model: settings.model, spokenLanguages: defaults.spokenLanguages, defaults });
}
function candidateReview(db: DB, runId: string) {
  const run = getRun(db, runId); if (run.status !== "paused" || run.reason !== "app_review") throw new Error("Candidates can be edited only while waiting for app review");
  const task = runTasks(db, runId).find(task => task.stage === "discovery")!;
  return { run, task, state: discoveryState(db, runId) };
}
// Startup hook for the single web-process deployment. Also called before
// candidate mutations, so a restarted server does not require a special boot
// route. Untagged pre-upgrade reservations are treated as abandoned as well.
export function recoverPendingCandidateAdditions(db: DB, processInstanceId = WEB_PROCESS_INSTANCE_ID): number {
  if (!processInstanceId.trim()) throw new Error("Candidate process identity is required");
  return transaction(db, () => {
    let released = 0;
    const tasks = db.query<{ id: string; checkpoint_json: string }, []>("SELECT id,checkpoint_json FROM tasks WHERE stage='discovery' AND json_array_length(checkpoint_json,'$.additions')>0").all();
    for (const task of tasks) {
      const checkpoint = decodeObject(task.checkpoint_json); const pending = checkpoint.additions as JsonObject[];
      const live = pending.filter(item => item.processInstanceId === processInstanceId);
      if (live.length === pending.length) continue;
      released += pending.length - live.length; checkpoint.additions = live;
      // Keep the consumed metadata count: the old process may have dispatched
      // its request before dying. Removing only reservation IDs releases slots
      // and ensures that any late result cannot pass the final ownership check.
      db.query("UPDATE tasks SET checkpoint_json=? WHERE id=?").run(encodeJson(checkpoint), task.id);
    }
    return released;
  });
}
export function removeCandidate(db: DB, runId: string, store: string, appId: string, processInstanceId = WEB_PROCESS_INSTANCE_ID): void {
  recoverPendingCandidateAdditions(db, processInstanceId);
  transaction(db, () => {
    const { task, state } = candidateReview(db, runId);
    state.selected = state.selected.filter(candidate => candidate.store !== store || candidate.appId !== appId);
    db.query("UPDATE tasks SET checkpoint_json=? WHERE id=?").run(encodeJson(state), task.id);
  });
}
export async function addCandidate(db: DB, runId: string, url: string, signal: AbortSignal, adapters = { apple: appleAdapter(), google: googleAdapter() } as Record<"apple"|"google", StoreAdapter>, processInstanceId = WEB_PROCESS_INSTANCE_ID): Promise<void> {
  const reference = parseStoreUrl(url); const key = `${reference.store}:${reference.appId}`; const reservationId = randomUUID();
  recoverPendingCandidateAdditions(db, processInstanceId);
  const reserved = transaction(db, () => {
    const { run, task, state } = candidateReview(db, runId); const settings = researchSettings(decodeObject(run.settings_json));
    const pending = state.additions ?? [];
    if (state.selected.some(candidate => candidate.store === reference.store && candidate.appId === reference.appId) || pending.some(item => item.key === key)) return null;
    if (state.selected.length + pending.length >= settings.appLimit) throw new Error("Remove an app or start a run with a higher listing limit");
    if (state.lookups >= PRESETS[settings.preset].metadataLookups) throw new Error("Candidate metadata lookup limit reached");
    state.lookups++; state.additions = [...pending, { key, reservationId, processInstanceId }];
    db.query("UPDATE tasks SET checkpoint_json=? WHERE id=?").run(encodeJson(state), task.id);
    return { country: reference.country ?? settings.countries[0], taskId: task.id };
  });
  if (!reserved) return;
  let dispatched = false;
  try {
    signal.throwIfAborted(); dispatched = true;
    const listing = await adapters[reference.store].details(reference.appId, { country: reserved.country, language: "en" }, signal);
    signal.throwIfAborted();
    if (listing.store !== reference.store || listing.appId !== reference.appId) throw new Error("Listing response identity mismatch");
    transaction(db, () => {
      const { run, task, state } = candidateReview(db, runId); const settings = researchSettings(decodeObject(run.settings_json));
      if (!state.additions?.some(item => item.key === key && item.reservationId === reservationId && item.processInstanceId === processInstanceId)) throw new Error("Candidate reservation no longer active");
      if (state.selected.some(candidate => candidate.store === reference.store && candidate.appId === reference.appId)) return;
      if (state.selected.length >= settings.appLimit || state.lookups > PRESETS[settings.preset].metadataLookups) throw new Error("Candidate limit reached");
      const sourceId = saveSource(db, runId, task.id, "manual-inclusion-v1", { kind: "listing", store: reference.store, appId: reference.appId, locale: `${listing.country}:${listing.language}`, url: listing.url, payload: JSON.parse(encodeJson(listing)), capturedAt: listing.capturedAt }, { explicit: true, request: listing.request });
      const candidate: CandidateRecord = { store: listing.store, appId: listing.appId, sourceId, country: listing.country, language: listing.language, title: listing.title, developerId: listing.developerId, rank: -1, relevance: "direct", reason: "Explicitly added during candidate review", included: true, intent: "Explicit inclusion", origins: [url] };
      state.selected.push(candidate); state.candidates = state.candidates.filter(old => old.store !== candidate.store || old.appId !== candidate.appId); state.candidates.push(candidate);
      state.additions = state.additions.filter(item => item.reservationId !== reservationId);
      db.query("UPDATE tasks SET checkpoint_json=? WHERE id=?").run(encodeJson(state), task.id);
    });
  } finally {
    transaction(db, () => {
      const state = discoveryState(db, runId);
      if (!state.additions?.some(item => item.reservationId === reservationId)) return;
      state.additions = state.additions.filter(item => item.reservationId !== reservationId);
      // A dispatched lookup still consumes the run's request allowance even if
      // the source fails. A reservation cancelled before dispatch is refunded.
      if (!dispatched) state.lookups--;
      db.query("UPDATE tasks SET checkpoint_json=? WHERE id=?").run(encodeJson(state), reserved.taskId);
    });
  }
}
export const SAVED_STATUSES = ["to_investigate", "investigating", "consider", "dismissed"] as const;
export function saveOpportunity(db: DB, opportunityId: string): string {
  const row = db.query<{ run_id: string }, [string]>("SELECT run_id FROM opportunities WHERE id=?").get(opportunityId);
  if (!row || getRun(db, row.run_id).status !== "completed") throw new Error("Save an opportunity from a completed report");
  const id = randomUUID(); const now = Date.now();
  db.query("INSERT INTO saved_opportunities(id,opportunity_id,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(opportunity_id) DO NOTHING").run(id, opportunityId, now, now);
  return db.query<{ id: string }, [string]>("SELECT id FROM saved_opportunities WHERE opportunity_id=?").get(opportunityId)!.id;
}
export function updateSaved(db: DB, id: string, status: string, notes: string): void {
  const parsedStatus = z.enum(SAVED_STATUSES).parse(status); z.string().max(20_000).parse(notes);
  const result = db.query("UPDATE saved_opportunities SET status=?,notes=?,updated_at=? WHERE id=?").run(parsedStatus, notes, Date.now(), id);
  if (!result.changes) throw new Error("Unknown saved opportunity");
}
export function listSaved(db: DB) { return db.query<{ id: string; opportunity_id: string; status: string; notes: string; run_id: string; title: string; report_json: string }, []>("SELECT saved.*,o.run_id,o.title,o.report_json FROM saved_opportunities saved JOIN opportunities o ON o.id=saved.opportunity_id ORDER BY saved.updated_at DESC").all().map(row => ({ ...row, report: decodeObject(row.report_json) })); }
export function refreshResearch(db: DB, runId: string): string { const old = getRun(db, runId); return createResearch(db, decodeObject(old.input_json), decodeObject(old.settings_json), old.budget_usd); }

export async function researchAction(db: DB, request: Request, value: unknown): Promise<JsonObject> {
  requireSameOrigin(request); const action = z.object({ intent: z.string(), runId: z.string().optional(), payload: z.unknown().optional() }).strict().parse(value);
  const runId = action.runId ?? ""; const payload = (action.payload ?? {}) as Record<string, unknown>;
  switch (action.intent) {
    case "create": return { runId: createResearch(db, payload.input, payload.settings, payload.budgetUsd === undefined ? undefined : z.number().nonnegative().parse(payload.budgetUsd)) };
    case "pause": pauseRun(db, runId); break;
    case "cancel": cancelRun(db, runId); break;
    case "resume": resumeRun(db, runId); break;
    case "continue": recoverPendingCandidateAdditions(db); candidateReview(db, runId); resumeRun(db, runId, { reviewed: true }); break;
    case "raise_budget": resumeRun(db, runId, { budgetUsd: z.number().nonnegative().parse(payload.budgetUsd) }); break;
    case "remove_candidate": removeCandidate(db, runId, z.string().parse(payload.store), z.string().parse(payload.appId)); break;
    case "add_candidate": await addCandidate(db, runId, z.string().parse(payload.url), request.signal); break;
    case "settings": updateSettings(db, payload); break;
    case "save": return { savedId: saveOpportunity(db, z.string().parse(payload.opportunityId)) };
    case "update_saved": updateSaved(db, z.string().parse(payload.id), z.string().parse(payload.status), z.string().parse(payload.notes)); break;
    case "refresh": return { runId: refreshResearch(db, runId) };
    default: throw new Error("Unknown action");
  }
  return { ok: true };
}
