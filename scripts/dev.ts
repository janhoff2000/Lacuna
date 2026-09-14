interface SupervisedChild {
  exited: Promise<number>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export async function superviseChildren(web: SupervisedChild, worker: SupervisedChild, shutdown: AbortSignal): Promise<number> {
  let stopping = false;
  let forcedExit: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Start the deadline before asking either child to exit: both may ignore SIGTERM.
    forcedExit = setTimeout(() => { web.kill("SIGKILL"); worker.kill("SIGKILL"); }, 5_000);
    web.kill("SIGTERM");
    worker.kill("SIGTERM");
  };
  shutdown.addEventListener("abort", stop);
  if (shutdown.aborted) stop();
  try {
    await Promise.race([web.exited, worker.exited]);
    stop();
    const exitCodes = await Promise.all([web.exited, worker.exited]);
    return exitCodes.some(code => code !== 0 && code !== 143) ? 1 : 0;
  } finally {
    if (forcedExit) clearTimeout(forcedExit);
    shutdown.removeEventListener("abort", stop);
  }
}

if (import.meta.main) {
  const web = Bun.spawn(["bun", "run", "dev:web"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const worker = Bun.spawn(["bun", "run", "worker"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.exitCode = await superviseChildren(web, worker, shutdown.signal);
}
