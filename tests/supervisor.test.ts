import { expect, spyOn, test } from "bun:test";
import { superviseChildren } from "../scripts/dev";

test("first shutdown starts a five-second deadline even when both children ignore SIGTERM", async () => {
  const children = Array.from({ length: 2 }, () => Bun.spawn([process.execPath, "-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.info("READY");'], { stdout: "pipe", stderr: "pipe" }));
  const shutdown = new AbortController();
  const signals: string[][] = [[], []];
  let supervision: Promise<number> | undefined;
  try {
    for (const child of children) {
      const reader = child.stdout.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("READY");
      reader.releaseLock();
    }
    const supervised = children.map((child, index) => ({ exited: child.exited, kill: (signal: "SIGTERM" | "SIGKILL") => { signals[index].push(signal); child.kill(signal); } }));
    supervision = superviseChildren(supervised[0], supervised[1], shutdown.signal);
    const started = performance.now();
    shutdown.abort();
    await Bun.sleep(100);
    // An additional shutdown notification must not reset the deadline or resend signals.
    shutdown.signal.dispatchEvent(new Event("abort"));
    expect(children.every(child => child.exitCode === null)).toBe(true);
    expect(await supervision).toBe(1);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(4_900);
    expect(elapsed).toBeLessThan(7_500);
    expect(signals).toEqual([["SIGTERM", "SIGKILL"], ["SIGTERM", "SIGKILL"]]);
  } finally {
    shutdown.abort();
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    await Promise.all(children.map(child => child.exited));
    await supervision;
  }
}, 10_000);

test("a child exit stops its sibling and clears the forced-stop timer", async () => {
  const clearTimer = spyOn(globalThis, "clearTimeout");
  const shutdown = new AbortController();
  const signals: string[][] = [[], []];
  let exitSibling!: (code: number) => void;
  const siblingExit = new Promise<number>(resolve => { exitSibling = resolve; });
  try {
    const result = await superviseChildren(
      { exited: Promise.resolve(0), kill: signal => { signals[0].push(signal); } },
      { exited: siblingExit, kill: signal => { signals[1].push(signal); exitSibling(143); } },
      shutdown.signal,
    );
    shutdown.abort();
    expect(result).toBe(0);
    expect(signals).toEqual([["SIGTERM"], ["SIGTERM"]]);
    expect(clearTimer).toHaveBeenCalledTimes(1);
  } finally { clearTimer.mockRestore(); }
});
