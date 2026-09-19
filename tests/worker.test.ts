import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type DB } from "../server/db";
import { acquireWorkerLock } from "../server/worker-lock";
import { createRun, getRun, getTask, heartbeat, pauseRun, workerStatus, type TaskRow } from "../server/runs";
import { budgetState } from "../server/ai";
import { runWorker } from "../server/worker";
import type { Handlers } from "../server/pipeline";
import { STAGES } from "../shared/types";

let directory: string; let path: string; let db: DB;
const children: Bun.Subprocess[] = [];
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "lacuna-worker-")); path = join(directory, "db.sqlite"); db = openDatabase(path); });
afterEach(async () => { for (const child of children.splice(0)) { if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; } db.close(); rmSync(directory, { recursive: true, force: true }); });
const settings = { preset: "quick" as const, countries: ["US"], spokenLanguages: ["en"], appLimit: 1, reviewLimit: 1, reviewCandidates: false };
async function until(predicate: () => boolean, timeout = 5000) { const deadline = Date.now() + timeout; while (!predicate()) { if (Date.now() > deadline) throw new Error("Timed out waiting for child state"); await Bun.sleep(10); } }
function child(mode: string) {
  const proc = Bun.spawn([process.execPath, "tests/fixtures/worker-child.ts", mode, path], { stdout: "pipe", stderr: "pipe" }); children.push(proc);
  let output = "";
  const read = (async () => { const reader = proc.stdout.getReader(); while (true) { const item = await reader.read(); if (item.done) break; output += new TextDecoder().decode(item.value); } })();
  return { proc, ready: async (text = "READY") => { await until(() => output.includes(text)); }, read };
}
test("OS advisory lock refuses a second process, ignores stale heartbeat, canonicalizes aliases, releases on SIGKILL", async () => {
  const owner = child("lock"); await owner.ready(); heartbeat(db, true, 0);
  expect(workerStatus(db)).toBe("not_responding"); expect(() => acquireWorkerLock(path)).toThrow("Another worker");
  symlinkSync(directory, join(directory, "alias")); expect(() => acquireWorkerLock(join(directory, "alias", "db.sqlite"))).toThrow("Another worker");
  const second = child("lock"); expect(await second.proc.exited).not.toBe(0);
  owner.proc.kill("SIGKILL"); await owner.proc.exited; const newOwner = acquireWorkerLock(path); newOwner.release();
});
test("database transaction persists exactly at commit across process termination", async () => {
  for (const mode of ["uncommitted", "committed"]) { const process = child(mode); await process.ready(); process.proc.kill("SIGKILL"); await process.proc.exited; }
  expect(db.query<{ input_json: string }, []>("SELECT input_json FROM runs").all()).toEqual([{ input_json: '{"marker":"committed"}' }]);
});
test("crashed worker preserves checkpoint, marks paid request unknown and requires manual Resume", async () => {
  const runId = createRun(db, {}, settings); const first = child("worker"); await first.ready("CLAIMED");
  const task = db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE run_id=?").get(runId)!;
  expect(task.status).toBe("running"); first.proc.kill("SIGKILL"); await first.proc.exited;
  const second = child("worker"); await second.ready();
  expect(getRun(db, runId).reason).toBe("interrupted"); expect(getTask(db, task.id).checkpoint_json).toBe('{"cursor":"committed-page-two"}');
  expect(budgetState(db, runId).unknown).toBe(true); expect(budgetState(db, runId).committedUsd).toBe(0.0014);
  expect(getTask(db, task.id).attempt_count).toBe(1); second.proc.kill("SIGTERM"); expect(await second.proc.exited).toBe(0); expect(workerStatus(db)).toBe("not_running");
});
test("pause aborts active handler and forbids its late completion", async () => {
  const runId = createRun(db, {}, settings); const process = child("worker"); await process.ready("CLAIMED");
  pauseRun(db, runId); await until(() => db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE run_id=?").get(runId)?.status === "pending");
  await Bun.sleep(150); expect(getRun(db, runId).reason).toBe("user");
  expect(budgetState(db, runId).unknown).toBe(true);
  expect(db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE run_id=?").get(runId)?.result_json).toBeNull();
  process.proc.kill("SIGTERM"); await process.proc.exited;
});
test("worker runs fake stages sequentially and exits cleanly", async () => {
  const runId = createRun(db, {}, settings); const shutdown = new AbortController();
  let inFlight = 0; let maxInFlight = 0;
  const handlers: Handlers = Object.fromEntries(STAGES.map(stage => [stage, async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await Bun.sleep(1); inFlight--; return { stage }; }]));
  const worker = runWorker({ path, signal: shutdown.signal, handlers });
  await until(() => getRun(db, runId).status === "completed"); shutdown.abort(); await worker;
  expect(maxInFlight).toBe(1); expect(workerStatus(db)).toBe("not_running");
  const next = acquireWorkerLock(path); next.release();
});
test("worker runs up to one hundred independent analysis tasks concurrently", async () => {
  const runId = createRun(db, {}, settings); const shutdown = new AbortController();
  let inFlight = 0; let maxInFlight = 0;
  const handlers: Handlers = Object.fromEntries(STAGES.map(stage => [stage, async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await Bun.sleep(20); inFlight--; return { stage };
  }]));
  const planner = (_run: unknown, stage: string) => stage === "analysis" ? Array.from({ length: 100 }, (_, index) => ({ key: `review-${index}` })) : [{ key: stage }];
  const worker = runWorker({ path, signal: shutdown.signal, handlers, planner, concurrency: 100 });
  await until(() => getRun(db, runId).status === "completed"); shutdown.abort(); await worker;
  expect(maxInFlight).toBe(100);
});
