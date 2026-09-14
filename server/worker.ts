import { openDatabase } from "./db";
import { acquireWorkerLock } from "./worker-lock";
import { activateNextRun, claimTask, completeTask, failTask, getRun, getTask, heartbeat, recoverInterrupted, yieldTask } from "./runs";
import { advancePipeline, type Handlers, type StagePlanner } from "./pipeline";
import { LIMITS } from "./policy";
import { markAiUnknown } from "./ai";
import { createResearchPipeline } from "./research";

export async function runWorker(options: { path?: string; signal: AbortSignal; handlers?: Handlers; planner?: StagePlanner; onReady?: () => void }): Promise<void> {
  // Acquire before opening/migrating the database, recovering work or publishing availability.
  const lock = acquireWorkerLock(options.path);
  let db: ReturnType<typeof openDatabase> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let taskAbort: AbortController | undefined;
  const abort = () => taskAbort?.abort();
  options.signal.addEventListener("abort", abort);
  try {
    db = openDatabase(options.path);
    const integration = createResearchPipeline(db);
    const handlers = options.handlers ?? integration.handlers;
    const planner = options.planner ?? integration.planner;
    recoverInterrupted(db); heartbeat(db, true);
    timer = setInterval(() => heartbeat(db!, true), LIMITS.heartbeatMs);
    options.onReady?.();
    while (!options.signal.aborted) {
      const run = activateNextRun(db);
      if (run) {
        advancePipeline(db, run.id, planner);
        const task = claimTask(db, run.id);
        if (task) {
          taskAbort = new AbortController();
          // Web actions persist pause/cancel; observing them aborts an active supported request.
          const watch = setInterval(() => {
            if (getRun(db!, run.id).status !== "running" || getTask(db!, task.id).attempt_id !== task.attempt_id) taskAbort?.abort();
          }, 100);
          const settleLostAccounting = () => {
            const unsettled = db!.query<{ id: string }, [string, string]>("SELECT id FROM ai_requests WHERE task_id=? AND attempt_id=? AND status='in_flight'").all(task.id, task.attempt_id!);
            for (const request of unsettled) markAiUnknown(db!, request.id);
          };
          try {
            const handler = handlers[task.stage];
            if (!handler) { failTask(db, task.id, task.attempt_id!, { code: "configuration", jitter: 0.5 }); }
            else {
              const result = await handler(task, taskAbort.signal);
              settleLostAccounting();
              if (!options.signal.aborted && getRun(db, run.id).status === "running" && getTask(db, task.id).attempt_id === task.attempt_id) {
                if (result.continue === true) yieldTask(db, task.id, task.attempt_id!);
                else completeTask(db, task.id, task.attempt_id!, result);
              }
            }
          } catch {
            // Persist a safe category, never provider error strings that might contain credentials.
            if (!options.signal.aborted && getRun(db, run.id).status === "running" && getTask(db, task.id).attempt_id === task.attempt_id) failTask(db, task.id, task.attempt_id!, { code: "temporary", jitter: Math.random() });
          } finally { clearInterval(watch); settleLostAccounting(); taskAbort = undefined; }
        }
      }
      if (!options.signal.aborted) await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timeout); options.signal.removeEventListener("abort", finish); resolve(); };
        const timeout = setTimeout(finish, 100);
        options.signal.addEventListener("abort", finish, { once: true });
      });
    }
  } finally {
    if (timer) clearInterval(timer);
    options.signal.removeEventListener("abort", abort);
    try { if (db) { recoverInterrupted(db); heartbeat(db, false); db.close(); } }
    finally { lock.release(); }
  }
}
