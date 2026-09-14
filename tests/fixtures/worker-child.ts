import { acquireWorkerLock } from "../../server/worker-lock";
import { openDatabase } from "../../server/db";
import { checkpointTask, createRun } from "../../server/runs";
import { reserveAi } from "../../server/ai";
import { runWorker } from "../../server/worker";

const [mode, path] = process.argv.slice(2);
const shutdown = new AbortController();
process.once("SIGTERM", () => shutdown.abort());
process.once("SIGINT", () => shutdown.abort());
const wait = async () => { if (!shutdown.signal.aborted) await new Promise<void>(resolve => shutdown.signal.addEventListener("abort", () => resolve(), { once: true })); };
if (mode === "lock") {
  const lock = acquireWorkerLock(path); console.info("READY"); await wait(); lock.release();
} else if (mode === "uncommitted" || mode === "committed") {
  const db = openDatabase(path); db.exec("BEGIN IMMEDIATE");
  createRun(db, { marker: mode }, { preset: "quick", countries: ["US"], appLimit: 1, reviewLimit: 1, reviewCandidates: false });
  if (mode === "committed") db.exec("COMMIT"); console.info("READY"); await wait(); db.close();
} else {
  await runWorker({ path, signal: shutdown.signal, onReady: () => console.info("READY"), handlers: {
    discovery: async (task, signal) => {
      const db = openDatabase(path);
      checkpointTask(db, task.id, task.attempt_id!, { cursor: "committed-page-two" });
      reserveAi(db, task.id, task.attempt_id!, { maxInputTokens: 1000, maxOutputTokens: 1000 });
      db.close(); console.info("CLAIMED");
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { stopped: true };
    },
  } });
}
