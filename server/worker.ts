import { openDatabase } from "./db";
import { acquireWorkerLock } from "./worker-lock";
import { activateNextRun, claimTask, completeTask, failTask, getRun, getTask, heartbeat, recoverInterrupted, yieldTask } from "./runs";
import { advancePipeline, type Handlers, type StagePlanner } from "./pipeline";
import { LIMITS } from "./policy";
import { markAiUnknown } from "./ai";
import { createResearchPipeline } from "./research";

export async function runWorker(options: { path?: string; signal: AbortSignal; handlers?: Handlers; planner?: StagePlanner; concurrency?: number; onReady?: () => void }): Promise<void> {
  // Acquire before opening/migrating the database, recovering work or publishing availability.
  const lock = acquireWorkerLock(options.path);
  let db: ReturnType<typeof openDatabase> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const concurrency = options.concurrency ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error("Invalid worker concurrency");
  const taskAborts = new Set<AbortController>();
  const active = new Set<Promise<void>>();
  const abort = () => taskAborts.forEach(controller => controller.abort());
  options.signal.addEventListener("abort", abort);
  try {
    db = openDatabase(options.path);
    const integration = createResearchPipeline(db);
    const handlers = options.handlers ?? integration.handlers;
    const planner = options.planner ?? integration.planner;
    recoverInterrupted(db); heartbeat(db, true);
    timer = setInterval(() => heartbeat(db!, true), LIMITS.heartbeatMs);
    options.onReady?.();
    const execute = async (runId: string, task: NonNullable<ReturnType<typeof claimTask>>) => {
      const taskAbort = new AbortController(); taskAborts.add(taskAbort);
      const watch = setInterval(() => {
        if (getRun(db!, runId).status !== "running" || getTask(db!, task.id).attempt_id !== task.attempt_id) taskAbort.abort();
      }, 100);
      const settleLostAccounting = () => {
        const unsettled = db!.query<{ id: string }, [string, string]>("SELECT id FROM ai_requests WHERE task_id=? AND attempt_id=? AND status='in_flight'").all(task.id, task.attempt_id!);
        for (const request of unsettled) markAiUnknown(db!, request.id);
      };
      try {
        const handler = handlers[task.stage];
        if (!handler) failTask(db!, task.id, task.attempt_id!, { code: "configuration", jitter: 0.5 });
        else {
          const result = await handler(task, taskAbort.signal);
          settleLostAccounting();
          if (!options.signal.aborted && getRun(db!, runId).status === "running" && getTask(db!, task.id).attempt_id === task.attempt_id) {
            if (result.continue === true) yieldTask(db!, task.id, task.attempt_id!);
            else completeTask(db!, task.id, task.attempt_id!, result);
          }
        }
      } catch {
        if (!options.signal.aborted && getRun(db!, runId).status === "running" && getTask(db!, task.id).attempt_id === task.attempt_id) failTask(db!, task.id, task.attempt_id!, { code: "temporary", jitter: Math.random() });
      } finally { clearInterval(watch); settleLostAccounting(); taskAborts.delete(taskAbort); }
    };
    while (!options.signal.aborted) {
      const run = activateNextRun(db);
      if (run) {
        advancePipeline(db, run.id, planner);
        while (!options.signal.aborted && active.size < concurrency) {
          const task = claimTask(db, run.id, Date.now(), concurrency);
          if (!task) break;
          const work = execute(run.id, task); active.add(work);
          void work.finally(() => active.delete(work));
        }
      }
      if (!options.signal.aborted) await Promise.race([...active, new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timeout); options.signal.removeEventListener("abort", finish); resolve(); };
        const timeout = setTimeout(finish, 100);
        options.signal.addEventListener("abort", finish, { once: true });
      })]);
    }
  } finally {
    abort(); await Promise.allSettled(active);
    if (timer) clearInterval(timer);
    options.signal.removeEventListener("abort", abort);
    try { if (db) { recoverInterrupted(db); heartbeat(db, false); db.close(); } }
    finally { lock.release(); }
  }
}
