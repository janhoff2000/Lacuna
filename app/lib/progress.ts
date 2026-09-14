import type { ProgressView } from "../components/workspace";
import { isActive } from "./workspace";
// One request at a time; cleanup aborts the request and prevents late updates.
export function startProgressPolling(
  url: string,
  callbacks: { onProgress: (value: ProgressView) => void; onError: () => void },
  options: {
    interval?: number;
    fetcher?: typeof fetch;
    visible?: () => boolean;
    events?: { document?: EventTarget; window?: EventTarget };
  } = {},
) {
  const controller = new AbortController();
  const fetcher = options.fetcher ?? fetch;
  const interval = options.interval ?? 3000;
  const visible =
    options.visible ??
    (() => typeof document === "undefined" || document.visibilityState === "visible");
  const events =
    options.events ??
    {
      document: typeof document === "undefined" ? undefined : document,
      window: typeof window === "undefined" ? undefined : window,
    };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let inFlight = false;
  let shouldPoll = true;
  const schedule = () => {
    if (!stopped && shouldPoll) timer = setTimeout(poll, interval);
  };
  const poll = async () => {
    if (stopped || inFlight || !shouldPoll) return;
    if (!visible()) {
      schedule();
      return;
    }
    inFlight = true;
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Progress unavailable");
      const value = (await response.json()) as ProgressView;
      if (
        !value ||
        typeof value.status !== "string" ||
        !value.counts ||
        !value.budget
      )
        throw new Error("Invalid progress");
      if (!stopped) callbacks.onProgress(value);
      shouldPoll = isActive(value.status);
    } catch {
      if (!stopped) callbacks.onError();
    } finally {
      inFlight = false;
      schedule();
    }
  };
  const refreshNow = () => {
    if (stopped || !shouldPoll || !visible()) return;
    if (timer) clearTimeout(timer);
    void poll();
  };
  events.document?.addEventListener("visibilitychange", refreshNow);
  events.window?.addEventListener("focus", refreshNow);
  timer = setTimeout(poll, interval);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    events.document?.removeEventListener("visibilitychange", refreshNow);
    events.window?.removeEventListener("focus", refreshNow);
    controller.abort();
  };
}
