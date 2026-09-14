import { runWorker } from "../server/worker";

const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  await runWorker({ signal: shutdown.signal, onReady: () => console.info("Lacuna worker ready. Eligible queued runs can start.") });
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("Another worker") ? error.message : "Worker failed; inspect local configuration and database access.");
  process.exitCode = 1;
}
