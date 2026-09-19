import { randomUUID } from "node:crypto";
import { getSetting, setSetting, transaction, type DB } from "./db";
import { FRESHNESS, LIMITS, POLICY_VERSION, PRESETS, retryAt } from "./policy";
import { decodeObject, encodeJson, parseRunSettings, type JsonObject, type RunReason, type RunSettings, type RunStatus, type Stage } from "../shared/types";

export interface RunRow {
  id: string; status: RunStatus; reason: RunReason; stage: Stage; budget_usd: number;
  input_json: string; settings_json: string; policy_version: string;
  coverage: "complete" | "gaps"; coverage_json: string; created_at: number; updated_at: number;
}
export interface TaskRow {
  id: string; run_id: string; stage: Stage; kind: string; dedupe_key: string;
  status: "pending" | "running" | "retry" | "completed" | "failed" | "cancelled" | "superseded";
  attempt_count: number; retry_count: number; attempt_id: string | null; next_retry_at: number | null;
  checkpoint_json: string; result_json: string | null; error_code: string | null;
  created_at: number; updated_at: number;
}
export function getRun(db: DB, id: string): RunRow {
  const run = db.query<RunRow, [string]>("SELECT * FROM runs WHERE id=?").get(id);
  if (!run) throw new Error("Unknown run");
  parseRunSettings(decodeObject(run.settings_json)); decodeObject(run.input_json); decodeObject(run.coverage_json);
  return run;
}
export function getTask(db: DB, id: string): TaskRow {
  const task = db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE id=?").get(id);
  if (!task) throw new Error("Unknown task");
  decodeObject(task.checkpoint_json); if (task.result_json) decodeObject(task.result_json);
  return task;
}
const LEGAL: Record<RunStatus, RunStatus[]> = {
  queued: ["running", "paused", "cancelled"], running: ["paused", "completed", "cancelled"],
  paused: ["queued", "cancelled"], cancelled: ["queued"], completed: [],
};
// Internal transaction primitive: callers compose all state changes into one commit.
export function transitionInTransaction(db: DB, id: string, status: RunStatus, reason: RunReason = null, now = Date.now()): void {
  const current = getRun(db, id);
  if (!LEGAL[current.status].includes(status)) throw new Error(`Illegal run transition ${current.status} -> ${status}`);
  if (status === "paused" ? reason === null : status === "cancelled" ? reason !== "user" : reason !== null) throw new Error("Invalid transition reason");
  if (status === "completed" && db.query("SELECT id FROM tasks WHERE run_id=? AND status NOT IN ('completed','superseded') LIMIT 1").get(id)) throw new Error("Cannot complete unfinished work");
  db.query("UPDATE runs SET status=?,reason=?,updated_at=? WHERE id=?").run(status, reason, now, id);
  if (status === "paused" || status === "cancelled") {
    db.query("UPDATE tasks SET status='pending',attempt_id=NULL,updated_at=? WHERE run_id=? AND status='running'").run(now, id);
  }
}
export function transitionRun(db: DB, id: string, status: RunStatus, reason: RunReason = null, now = Date.now()): void {
  transaction(db, () => transitionInTransaction(db, id, status, reason, now));
}
export function createRun(db: DB, input: JsonObject, settings: RunSettings, budgetUsd: number = PRESETS[settings.preset].budgetUsd, now = Date.now()): string {
  parseRunSettings(settings); const inputJson = encodeJson(input);
  const settingsJson = encodeJson({ ...settings, policy: { version: POLICY_VERSION, preset: PRESETS[settings.preset], limits: LIMITS, freshness: FRESHNESS } });
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw new Error("Invalid budget");
  const id = randomUUID();
  db.query("INSERT INTO runs(id,input_json,settings_json,policy_version,status,stage,budget_usd,created_at,updated_at) VALUES(?,?,?,?,'queued','discovery',?,?,?)").run(id, inputJson, settingsJson, POLICY_VERSION, budgetUsd, now, now);
  return id;
}
export const pauseRun = (db: DB, id: string) => transitionRun(db, id, "paused", "user");
export const cancelRun = (db: DB, id: string) => transitionRun(db, id, "cancelled", "user");
export function resumeRun(db: DB, id: string, options: { reviewed?: boolean; budgetUsd?: number } = {}, now = Date.now()): void {
  transaction(db, () => {
    const run = getRun(db, id);
    if (run.reason === "app_review" && !options.reviewed) throw new Error("Candidate review must be confirmed");
    if (options.budgetUsd !== undefined) {
      if (!Number.isFinite(options.budgetUsd) || options.budgetUsd < run.budget_usd) throw new Error("Continuation budget cannot decrease");
      db.query("UPDATE runs SET budget_usd=? WHERE id=?").run(options.budgetUsd, id);
    }
    transitionInTransaction(db, id, "queued", null, now);
    db.query("UPDATE tasks SET status='pending',attempt_id=NULL,retry_count=0,next_retry_at=NULL,error_code=NULL,updated_at=? WHERE run_id=? AND status IN ('failed','cancelled')").run(now, id);
    if (run.reason === "app_review") db.query("UPDATE runs SET stage='collection' WHERE id=?").run(id);
  });
}
export function markCoverage(db: DB, id: string, details: JsonObject): void {
  const existing = decodeObject(getRun(db, id).coverage_json);
  db.query("UPDATE runs SET coverage='gaps',coverage_json=?,updated_at=? WHERE id=?").run(encodeJson({ ...existing, ...details }), Date.now(), id);
}
export function yieldTask(db: DB, id: string, attemptId: string, now = Date.now()): void {
  transaction(db, () => {
    const task = assertAttempt(db, id, attemptId);
    const latest = db.query<{ latest: number }, [string]>("SELECT MAX(updated_at) AS latest FROM tasks WHERE run_id=?").get(task.run_id)!.latest;
    db.query("UPDATE tasks SET status='pending',attempt_id=NULL,retry_count=0,updated_at=? WHERE id=?").run(Math.max(now, latest + 1), id);
  });
}
export function createTask(db: DB, runId: string, stage: Stage, key: string, kind: string = stage, checkpoint: JsonObject = {}, now = Date.now()): string {
  const id = randomUUID();
  db.query("INSERT INTO tasks(id,run_id,stage,kind,dedupe_key,status,checkpoint_json,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?,?) ON CONFLICT(run_id,stage,dedupe_key) DO NOTHING").run(id, runId, stage, kind, key, encodeJson(checkpoint), now, now);
  return db.query<{ id: string }, [string, string, string]>("SELECT id FROM tasks WHERE run_id=? AND stage=? AND dedupe_key=?").get(runId, stage, key)!.id;
}
export function activateNextRun(db: DB, now = Date.now()): RunRow | null {
  return transaction(db, () => {
    const active = db.query<RunRow, []>("SELECT * FROM runs WHERE status='running'").get();
    if (active) return getRun(db, active.id);
    const next = db.query<{ id: string }, []>("SELECT id FROM runs WHERE status='queued' ORDER BY created_at,id LIMIT 1").get();
    if (!next) return null;
    transitionInTransaction(db, next.id, "running", null, now);
    return getRun(db, next.id);
  });
}
export function claimTask(db: DB, runId: string, now = Date.now(), maxConcurrent = 1): TaskRow | null {
  return transaction(db, () => {
    const run = getRun(db, runId);
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("Invalid task concurrency");
    const { running } = db.query<{ running: number }, []>("SELECT COUNT(*) AS running FROM tasks WHERE status='running'").get()!;
    if (run.status !== "running" || running >= maxConcurrent) return null;
    const task = db.query<TaskRow, [string, string, number]>("SELECT * FROM tasks WHERE run_id=? AND stage=? AND status IN ('pending','retry') AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY updated_at,created_at,json_extract(checkpoint_json,'$.appIndex'),json_extract(checkpoint_json,'$.streamIndex'),id LIMIT 1").get(runId, run.stage, now);
    if (!task) return null;
    db.query("UPDATE tasks SET status='running',attempt_id=?,attempt_count=attempt_count+1,retry_count=retry_count+1,next_retry_at=NULL,updated_at=? WHERE id=?").run(randomUUID(), now, task.id);
    return getTask(db, task.id);
  });
}
export function assertAttempt(db: DB, id: string, attemptId: string): TaskRow {
  const task = getTask(db, id);
  if (task.status !== "running" || task.attempt_id !== attemptId || getRun(db, task.run_id).status !== "running") throw new Error("Stale task attempt");
  return task;
}
export function checkpointTask(db: DB, id: string, attemptId: string, checkpoint: JsonObject, writeResults?: () => void, now = Date.now()): void {
  const encoded = encodeJson(checkpoint);
  transaction(db, () => {
    assertAttempt(db, id, attemptId);
    const result: unknown = writeResults?.();
    if (result instanceof Promise) throw new Error("Checkpoint writes must be synchronous");
    db.query("UPDATE tasks SET checkpoint_json=?,updated_at=? WHERE id=?").run(encoded, now, id);
  });
}
export function completeTask(db: DB, id: string, attemptId: string, result: JsonObject, writeResults?: () => void, now = Date.now()): void {
  const encoded = encodeJson(result);
  transaction(db, () => {
    assertAttempt(db, id, attemptId);
    const writes: unknown = writeResults?.();
    if (writes instanceof Promise) throw new Error("Result writes must be synchronous");
    db.query("UPDATE tasks SET status='completed',result_json=?,updated_at=? WHERE id=?").run(encoded, now, id);
  });
}
export function failTask(db: DB, id: string, attemptId: string, failure: { code: "temporary" | "authentication" | "configuration"; jitter: number; retryAt?: number }, now = Date.now()): void {
  transaction(db, () => {
    const task = assertAttempt(db, id, attemptId);
    const retry = failure.code === "temporary" ? retryAt(now, task.retry_count, failure.jitter, failure.retryAt) : null;
    db.query("UPDATE tasks SET status=?,attempt_id=NULL,error_code=?,next_retry_at=?,updated_at=? WHERE id=?").run(retry === null ? "failed" : "retry", failure.code, retry, now, id);
    if (retry === null) transitionInTransaction(db, task.run_id, "paused", "error", now);
  });
}
export function recoverInterrupted(db: DB, now = Date.now()): number {
  return transaction(db, () => {
    const active = db.query<{ id: string }, []>("SELECT id FROM runs WHERE status='running'").all();
    for (const run of active) transitionInTransaction(db, run.id, "paused", "interrupted", now);
    db.query("UPDATE ai_requests SET status='unknown',error_code='worker_interrupted',updated_at=? WHERE status='in_flight'").run(now);
    return active.length;
  });
}
export const WORKER_SETTING = "worker_status";
export function heartbeat(db: DB, running: boolean, now = Date.now()): void {
  setSetting(db, WORKER_SETTING, { running, pid: process.pid, updatedAt: now }, now);
}
export function workerStatus(db: DB, now = Date.now()): "running" | "not_running" | "not_responding" {
  const value = getSetting(db, WORKER_SETTING);
  if (!value || value.running === false) return "not_running";
  if (value.running !== true || typeof value.updatedAt !== "number" || now - value.updatedAt >= LIMITS.heartbeatStaleMs || now < value.updatedAt) return "not_responding";
  return "running";
}
