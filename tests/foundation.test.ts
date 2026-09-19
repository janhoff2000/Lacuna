import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, transaction, type DB } from "../server/db";
import { activateNextRun, cancelRun, checkpointTask, claimTask, completeTask, createRun, createTask, failTask, getRun, getTask, heartbeat, pauseRun, recoverInterrupted, resumeRun, transitionRun, workerStatus } from "../server/runs";
import { budgetState, finalizeAi, getAiRequest, markAiUnknown, reserveAi } from "../server/ai";
import { advancePipeline } from "../server/pipeline";
import { collectionRequestCount, parseCollectionCheckpoint, replaceCollectionTask } from "../server/collections";
import { saveSource, type SourceSnapshot } from "../server/sources";
import { decodeObject, encodeJson, parseRunSettings, type RunSettings } from "../shared/types";

const settings: RunSettings = { preset: "quick", countries: ["US"], appLimit: 10, reviewLimit: 2000, reviewCandidates: false };
let directory: string; let db: DB; let path: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "lacuna-foundation-")); path = join(directory, "test.sqlite"); db = openDatabase(path); });
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
function running(budget = 1) { const runId = createRun(db, { need: "test" }, settings, budget); activateNextRun(db); const taskId = createTask(db, runId, "discovery", "search"); const task = claimTask(db, runId)!; return { runId, taskId, task }; }
function reservation(taskId: string, attemptId: string, input = 1000, output = 1000) { const request = reserveAi(db, taskId, attemptId, { maxInputTokens: input, maxOutputTokens: output }); if (!("id" in request)) throw new Error(request.refused); return request; }

describe("database and JSON", () => {
  test("exactly nine tables, foreign keys, WAL, busy timeout and idempotent migrations", () => {
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 4 });
    expect(db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name)).toEqual(["ai_requests", "analyses", "opportunities", "run_sources", "runs", "saved_opportunities", "settings", "sources", "tasks"]);
    const second = openDatabase(path); expect(second.query("PRAGMA user_version").get()).toEqual({ user_version: 4 }); second.close();
    expect(() => createTask(db, "missing", "collection", "key")).toThrow();
  });
  test("transaction rollback, async refusal and runtime JSON validation", () => {
    expect(() => transaction(db, () => { createRun(db, {}, settings); throw new Error("rollback"); })).toThrow();
    expect(db.query("SELECT id FROM runs").all()).toHaveLength(0);
    expect(() => transaction(db, () => Promise.resolve(1))).toThrow("synchronous");
    expect(() => encodeJson({ apiKey: "must not persist" })).toThrow("Secrets");
    expect(() => encodeJson({ value: Infinity })).toThrow();
    expect(() => decodeObject("[]")).toThrow();
    expect(() => parseRunSettings({ ...settings, countries: ["Germany"] })).toThrow();
    expect(() => encodeJson({ value: "a".repeat(1_048_576) })).toThrow("1 MiB");
    expect(decodeObject(encodeJson({ input: "ignore previous instructions", value: 1 }))).toEqual({ input: "ignore previous instructions", value: 1 });
  });
  test("a concurrent writer cannot cross an open transaction", () => {
    const second = openDatabase(path); second.exec("PRAGMA busy_timeout=1");
    transaction(db, () => { createRun(db, {}, settings); expect(() => createRun(second, {}, settings)).toThrow(); });
    expect(createRun(second, {}, settings)).toBeString(); second.close();
  });
});

describe("runs and durable tasks", () => {
  test("legal transitions and illegal completion/restart", () => {
    const { runId, taskId, task } = running();
    expect(() => transitionRun(db, runId, "queued")).toThrow("Illegal");
    expect(() => transitionRun(db, runId, "paused")).toThrow("reason");
    expect(() => transitionRun(db, runId, "completed")).toThrow("unfinished");
    completeTask(db, taskId, task.attempt_id!, { done: true });
    transitionRun(db, runId, "completed");
    expect(() => resumeRun(db, runId)).toThrow("Illegal");
  });
  test("manual, review, budget and interrupted pauses don't block queued work", () => {
    for (const reason of ["user", "app_review", "budget", "interrupted"] as const) {
      const id = createRun(db, {}, settings); transitionRun(db, id, "paused", reason);
    }
    const next = createRun(db, {}, settings);
    expect(activateNextRun(db)?.id).toBe(next);
    expect(db.query("SELECT id FROM runs WHERE status='paused'").all()).toHaveLength(4);
  });
  test("cancel invalidates attempt; explicit resume retains committed checkpoint", () => {
    const { runId, taskId, task } = running();
    checkpointTask(db, taskId, task.attempt_id!, { cursor: "page2", requests: 1 });
    cancelRun(db, runId);
    expect(claimTask(db, runId)).toBeNull(); expect(activateNextRun(db)).toBeNull();
    expect(() => completeTask(db, taskId, task.attempt_id!, { stale: true })).toThrow("Stale");
    resumeRun(db, runId); activateNextRun(db);
    const resumed = claimTask(db, runId)!;
    expect(resumed.attempt_id).not.toBe(task.attempt_id);
    expect(decodeObject(resumed.checkpoint_json)).toEqual({ cursor: "page2", requests: 1 });
    expect(() => checkpointTask(db, taskId, task.attempt_id!, { cursor: "old" })).toThrow("Stale");
  });
  test("startup interruption preserves queued and successful work without auto resume", () => {
    const { runId, taskId, task } = running(); checkpointTask(db, taskId, task.attempt_id!, { cursor: "saved" });
    const queued = createRun(db, {}, settings);
    expect(recoverInterrupted(db)).toBe(1); expect(getRun(db, runId).reason).toBe("interrupted");
    expect(getTask(db, taskId).attempt_id).toBeNull();
    expect(activateNextRun(db)?.id).toBe(queued);
    db.close(); db = openDatabase(path); expect(getRun(db, runId).status).toBe("paused");
    expect(decodeObject(getTask(db, taskId).checkpoint_json)).toEqual({ cursor: "saved" });
  });
  test("task dedup, atomic claim and completed task not rerun", () => {
    const { runId, taskId, task } = running(); const second = openDatabase(path);
    expect(createTask(second, runId, "discovery", "search")).toBe(taskId); expect(claimTask(second, runId)).toBeNull();
    completeTask(db, taskId, task.attempt_id!, { result: true });
    expect(claimTask(second, runId)).toBeNull(); second.close();
    pauseRun(db, runId); resumeRun(db, runId); activateNextRun(db); expect(claimTask(db, runId)).toBeNull();
  });
  test("retry timing, exhaustion, explicit restart of retry window and auth attention", () => {
    const { runId, taskId, task } = running();
    failTask(db, taskId, task.attempt_id!, { code: "temporary", jitter: 0.5, retryAt: 10_000 }, 1_000);
    expect(claimTask(db, runId, 9_999)).toBeNull();
    const second = claimTask(db, runId, 10_000)!; failTask(db, taskId, second.attempt_id!, { code: "temporary", jitter: 0.5 }, 10_000);
    const third = claimTask(db, runId, 12_000)!; failTask(db, taskId, third.attempt_id!, { code: "temporary", jitter: 0.5 }, 12_000);
    expect(getTask(db, taskId).status).toBe("failed"); expect(getRun(db, runId).reason).toBe("error");
    resumeRun(db, runId); activateNextRun(db); const resumed = claimTask(db, runId)!;
    expect(resumed.attempt_count).toBe(4); expect(resumed.retry_count).toBe(1);
    failTask(db, taskId, resumed.attempt_id!, { code: "authentication", jitter: 0.5 });
    expect(getTask(db, taskId).next_retry_at).toBeNull(); expect(getRun(db, runId).status).toBe("paused");
  });
  test("heartbeat distinguishes missing, clean exit and stale at 20 seconds", () => {
    expect(workerStatus(db, 0)).toBe("not_running"); heartbeat(db, true, 1000);
    expect(workerStatus(db, 20_999)).toBe("running"); expect(workerStatus(db, 21_000)).toBe("not_responding");
    heartbeat(db, false, 22_000); expect(workerStatus(db, 100_000)).toBe("not_running");
  });
  test("fixed stages finish; candidate review requires explicit confirmation", () => {
    const runId = createRun(db, {}, { ...settings, reviewCandidates: true }); activateNextRun(db);
    advancePipeline(db, runId); const discovery = claimTask(db, runId)!; completeTask(db, discovery.id, discovery.attempt_id!, { found: 2 });
    advancePipeline(db, runId); expect(getRun(db, runId).reason).toBe("app_review");
    expect(() => resumeRun(db, runId)).toThrow("confirmed"); resumeRun(db, runId, { reviewed: true }); activateNextRun(db);
    for (const stage of ["collection", "analysis", "grouping", "verification", "report"] as const) {
      advancePipeline(db, runId); const task = claimTask(db, runId)!; expect(task.stage).toBe(stage); completeTask(db, task.id, task.attempt_id!, { stage });
    }
    advancePipeline(db, runId); expect(getRun(db, runId).status).toBe("completed");
  });
  test("no matching apps goes straight to an actionable report", () => {
    const { runId, taskId, task } = running(); completeTask(db, taskId, task.attempt_id!, { noMatchingApps: true });
    advancePipeline(db, runId); const report = claimTask(db, runId)!;
    expect(report.stage).toBe("report"); expect(report.kind).toBe("no_matching_apps");
    expect(decodeObject(report.checkpoint_json).message).toContain("Adjust");
    completeTask(db, report.id, report.attempt_id!, { noMatchingApps: true }); advancePipeline(db, runId);
    expect(getRun(db, runId).status).toBe("completed");
  });
  test("expired cursor replaces a collection segment without mixing generations or resetting run request counts", () => {
    const runId = createRun(db, {}, settings); activateNextRun(db);
    db.query("UPDATE runs SET stage='collection' WHERE id=?").run(runId);
    const checkpoint = { version: "original", scopeHash: "scope", startedAt: 1000, endedAt: null, quota: 10, uniqueCount: 5, pages: 2, requestAttempts: 3, noNewIdPages: 0, cursor: "expired", seenCursors: ["page1"], stopReason: null, complete: false };
    const oldId = createTask(db, runId, "collection", "stream", "reviews", checkpoint);
    const oldAttempt = claimTask(db, runId)!;
    const newId = replaceCollectionTask(db, oldId, "cursor_invalid", 2000);
    expect(replaceCollectionTask(db, oldId, "cursor_invalid", 3000)).toBe(newId);
    expect(getTask(db, oldId).status).toBe("superseded");
    expect(parseCollectionCheckpoint(getTask(db, oldId).checkpoint_json).cursor).toBe("expired");
    const fresh = parseCollectionCheckpoint(getTask(db, newId).checkpoint_json);
    expect(fresh.cursor).toBeNull(); expect(fresh.version).not.toBe("original"); expect(fresh.pages).toBe(0);
    expect(collectionRequestCount(db, runId)).toBe(3);
    expect(() => completeTask(db, oldId, oldAttempt.attempt_id!, {})).toThrow("Stale");
    expect(() => parseCollectionCheckpoint('{"version":"invalid"}')).toThrow();
  });
});

describe("AI budget ledger without live API calls", () => {
  test("reserve worst-case before dispatch, permits bounded parallel work and records exact pricing", () => {
    const { taskId, task, runId } = running(); const request = reservation(taskId, task.attempt_id!);
    expect(request.reservedUsd).toBe(0.0014);
    const parallelId = createTask(db, runId, "discovery", "parallel"); const parallel = claimTask(db, runId, Date.now(), 2)!;
    expect(parallel.id).toBe(parallelId);
    expect(reserveAi(db, parallelId, parallel.attempt_id!, { maxInputTokens: 1, maxOutputTokens: 1 })).toMatchObject({ reservedUsd: 0.0000014 });
    expect(budgetState(db, runId).remainingUsd).toBeCloseTo(0.9985986);
    finalizeAi(db, request.id, { inputTokens: 500, outputTokens: 100 }, null, "provider-id");
    expect(getAiRequest(db, request.id).estimated_usd).toBe(0.00022);
    expect(getAiRequest(db, request.id).known_charge_usd).toBeNull();
    expect(() => reservation(taskId, task.attempt_id!)).toThrow(); // same logical attempt cannot dispatch twice
    expect(() => finalizeAi(db, request.id, null, 0)).toThrow("already finalized");
  });
  test("insufficient budget and unpriced model pause before creating a paid attempt", () => {
    const { taskId, task, runId } = running(0.001);
    expect(reserveAi(db, taskId, task.attempt_id!, { maxInputTokens: 1000, maxOutputTokens: 1000 })).toEqual({ refused: "budget" });
    expect(getRun(db, runId).reason).toBe("budget"); expect(db.query("SELECT id FROM ai_requests").all()).toHaveLength(0);
    resumeRun(db, runId, { budgetUsd: 1 }); activateNextRun(db); const next = claimTask(db, runId)!;
    expect(reserveAi(db, taskId, next.attempt_id!, { maxInputTokens: 1, maxOutputTokens: 1, model: "unknown" })).toEqual({ refused: "pricing_unknown" });
  });
  test("unknown response preserves reservation across restart and blocks paid continuation", () => {
    const { taskId, task, runId } = running(); const request = reservation(taskId, task.attempt_id!);
    recoverInterrupted(db); expect(getAiRequest(db, request.id).status).toBe("unknown");
    expect(budgetState(db, runId).committedUsd).toBe(request.reservedUsd);
    resumeRun(db, runId, { budgetUsd: 2 }); activateNextRun(db); const next = claimTask(db, runId)!;
    expect(reserveAi(db, taskId, next.attempt_id!, { maxInputTokens: 1, maxOutputTokens: 1 })).toEqual({ refused: "unknown_cost" });
    finalizeAi(db, request.id, null, 0.0009); expect(budgetState(db, runId).unknown).toBe(false);
    expect(budgetState(db, runId).knownChargeUsd).toBe(0.0009);
  });
  test("late accounting survives cancel, unknown loss pauses, charges separate from usage estimate", () => {
    const { taskId, task, runId } = running(); const request = reservation(taskId, task.attempt_id!);
    cancelRun(db, runId); finalizeAi(db, request.id, { inputTokens: 200, outputTokens: 200 }, 0.0003);
    expect(getRun(db, runId).status).toBe("cancelled"); expect(getAiRequest(db, request.id).estimated_usd).toBe(0.00028);
    expect(budgetState(db, runId).committedUsd).toBe(0.0003);
    resumeRun(db, runId); activateNextRun(db); const next = claimTask(db, runId)!; const lost = reservation(taskId, next.attempt_id!);
    markAiUnknown(db, lost.id); expect(getRun(db, runId).reason).toBe("budget");
    expect(getAiRequest(db, lost.id).reserved_usd).toBe(0.0014);
  });
});

describe("immutable source snapshots and atomic page checkpoints", () => {
  const snapshot: SourceSnapshot = { kind: "review", store: "apple", appId: "app", reviewId: "r1", identityVerified: true, locale: "US", url: "https://example.com/review", payload: { text: "Useful" }, capturedAt: 1000 };
  test("replacement selects changed review content atomically while retaining superseded observations", () => {
    const runId = createRun(db, {}, settings); activateNextRun(db);
    db.query("UPDATE runs SET stage='collection' WHERE id=?").run(runId);
    const checkpoint = { version: "old", scopeHash: "scope", startedAt: 1000, endedAt: null, quota: 10, uniqueCount: 1, pages: 1, requestAttempts: 1, noNewIdPages: 0, cursor: "old-cursor", seenCursors: [], stopReason: null, complete: false };
    const oldTaskId = createTask(db, runId, "collection", "old-stream", "reviews", checkpoint);
    const oldTask = claimTask(db, runId)!;
    let oldSourceId = "";
    checkpointTask(db, oldTaskId, oldTask.attempt_id!, checkpoint, () => { oldSourceId = saveSource(db, runId, oldTaskId, "old", snapshot, {}, true); });
    const newTaskId = replaceCollectionTask(db, oldTaskId, "stale", 2000);
    const newTask = claimTask(db, runId)!;
    const newCheckpoint = decodeObject(newTask.checkpoint_json);
    const newSnapshot = { ...snapshot, payload: { text: "Changed review content" }, capturedAt: 2000 };
    const newSourceId = saveSource(db, runId, newTaskId, String(newCheckpoint.version), newSnapshot, {}, false);
    expect(newSourceId).not.toBe(oldSourceId);
    const representatives = () => db.query<{ source_id: string; task_id: string; selected: number; counted: number }, [string]>("SELECT source_id,task_id,selected,counted FROM run_sources WHERE run_id=? AND counted=1").all(runId);
    expect(representatives()).toEqual([{ source_id: oldSourceId, task_id: oldTaskId, selected: 1, counted: 1 }]);
    expect(() => checkpointTask(db, newTaskId, newTask.attempt_id!, newCheckpoint, () => {
      saveSource(db, runId, newTaskId, String(newCheckpoint.version), newSnapshot, {}, true);
      throw new Error("rollback representative transfer");
    })).toThrow("rollback");
    expect(representatives()[0].source_id).toBe(oldSourceId);
    checkpointTask(db, newTaskId, newTask.attempt_id!, newCheckpoint, () => {
      saveSource(db, runId, newTaskId, String(newCheckpoint.version), newSnapshot, {}, true);
    });
    expect(representatives()).toEqual([{ source_id: newSourceId, task_id: newTaskId, selected: 1, counted: 1 }]);
    expect(db.query("SELECT id FROM run_sources WHERE selected=1").all()).toHaveLength(1);
    expect(db.query<{ selected: number; counted: number }, [string]>("SELECT selected,counted FROM run_sources WHERE task_id=?").get(oldTaskId)).toEqual({ selected: 0, counted: 0 });
    expect(getTask(db, oldTaskId).status).toBe("superseded");
    expect(db.query<{ payload_json: string }, [string]>("SELECT payload_json FROM sources WHERE id=?").get(oldSourceId)?.payload_json).toBe('{"text":"Useful"}');
    expect(db.query<{ payload_json: string }, [string]>("SELECT payload_json FROM sources WHERE id=?").get(newSourceId)?.payload_json).toBe('{"text":"Changed review content"}');
    saveSource(db, runId, newTaskId, String(newCheckpoint.version), newSnapshot, {}, true);
    expect(representatives()).toHaveLength(1); expect(db.query("SELECT id FROM run_sources").all()).toHaveLength(2);
  });
  test("overlapping locales count once and failed checkpoint leaves no partial writes", () => {
    const { runId, taskId, task } = running();
    expect(() => checkpointTask(db, taskId, task.attempt_id!, { cursor: "next" }, () => { saveSource(db, runId, taskId, "v1", snapshot, { locale: "US" }, true); throw new Error("before commit"); })).toThrow();
    expect(db.query("SELECT * FROM sources").all()).toHaveLength(0); expect(decodeObject(getTask(db, taskId).checkpoint_json)).toEqual({});
    checkpointTask(db, taskId, task.attempt_id!, { cursor: "next" }, () => {
      saveSource(db, runId, taskId, "v1", snapshot, { locale: "US" }, true);
      saveSource(db, runId, taskId, "v1", { ...snapshot, locale: "GB" }, { locale: "GB" }, true);
    });
    expect(db.query("SELECT * FROM sources").all()).toHaveLength(2);
    expect(db.query("SELECT * FROM run_sources WHERE counted=1").all()).toHaveLength(1);
    expect(db.query("SELECT * FROM run_sources WHERE selected=1").all()).toHaveLength(1);
    expect(() => db.exec("UPDATE sources SET payload_json='{}'")).toThrow("immutable");
  });
  test("untrusted IDs stay quarantined and refresh leaves old source and notes intact", () => {
    const { runId, taskId, task } = running();
    expect(() => checkpointTask(db, taskId, task.attempt_id!, {}, () => { saveSource(db, runId, taskId, "v1", { ...snapshot, identityVerified: false }, {}, true); })).toThrow("Unverified");
    let oldId = "";
    checkpointTask(db, taskId, task.attempt_id!, {}, () => { oldId = saveSource(db, runId, taskId, "v1", snapshot, {}, true); });
    db.query("INSERT INTO opportunities(id,run_id,report_key,title,priority,confidence,report_json,created_at) VALUES('op',?,'report','Test',1,'low',?,1)").run(runId, encodeJson({ sourceIds: [oldId] }));
    db.exec("INSERT INTO saved_opportunities(id,opportunity_id,notes,created_at,updated_at) VALUES('save','op','Keep these notes',1,1)");
    const refreshed = createRun(db, { refreshOf: runId }, settings); const refreshTask = createTask(db, refreshed, "collection", "new-segment");
    saveSource(db, refreshed, refreshTask, "v2", { ...snapshot, payload: { text: "Updated" }, capturedAt: 2000 }, {}, true);
    expect(db.query<{ payload_json: string }, [string]>("SELECT payload_json FROM sources WHERE id=?").get(oldId)?.payload_json).toBe('{"text":"Useful"}');
    expect(db.query<{ notes: string }, []>("SELECT notes FROM saved_opportunities").get()?.notes).toBe("Keep these notes");
    expect(getRun(db, runId).input_json).toBe('{"need":"test"}');
  });
});
