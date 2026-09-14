import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { openDatabase, type DB } from "../server/db";
import {
  createResearch,
  listResearch,
  listSaved,
  readSettings,
  saveOpportunity,
} from "../server/operations";
import { defaultResearchSettings } from "../server/research-input";
import {
  parseResearchForm,
  workspaceAction,
  FormError,
} from "../app/lib/actions.server";
import { startProgressPolling } from "../app/lib/progress";
import {
  opportunityUrl,
  runLabel,
  sourceAnchor,
  themeScript,
  type FormValues,
} from "../app/lib/workspace";
import {
  SAMPLE_OPPORTUNITIES,
  SAMPLE_PROGRESS,
  SAMPLE_SOURCES,
} from "../app/lib/sample";
import { NewResearchForm } from "../app/components/research-form";
import { CoverageDetails, OpportunityDetail, ReportWorkspace, type ResearchView } from "../app/components/report";
import { Notice, ProgressPanel } from "../app/components/workspace";
import Saved from "../app/routes/saved";

let directory: string;
let db: DB;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lacuna-ui-test-"));
  db = openDatabase(join(directory, "test.sqlite"));
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
const values: FormValues = {
  intent: "create",
  mode: "topic",
  query: "Sample offline shopping",
  stores: ["apple", "google"],
  preset: "quick",
  countries: "US, DE",
  languages: "",
  appLimit: "10",
  reviewLimit: "2000",
  budgetUsd: "0",
  direction: "android_to_ios",
  crossPlatform: "on",
};
function request(fields: FormValues, origin = "http://localhost:5173") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value])
      form.append(key, item);
  return new Request("http://localhost:5173/research/new", {
    method: "POST",
    headers: { Origin: origin },
    body: form,
  });
}
function render(element: React.ReactNode, loaderData?: unknown) {
  const router = createMemoryRouter(
    [
      {
        id: "test",
        path: "/",
        element,
        loader: loaderData === undefined ? undefined : () => loaderData,
      },
    ],
    {
      hydrationData:
        loaderData === undefined
          ? undefined
          : { loaderData: { test: loaderData } },
    },
  );
  const html = renderToString(<RouterProvider router={router} />);
  router.dispose();
  return html;
}

describe("workspace forms use real operations", () => {
  test("create preserves scope, ceiling and review choices with a real redirect", async () => {
    const result = await workspaceAction(
      request({ ...values, reviewCandidates: "on" }),
      ["create"],
      undefined,
      db,
    );
    expect(result instanceof Response).toBe(true);
    if (!(result instanceof Response)) throw new Error("Expected redirect");
    expect(result.status).toBe(302);
    const run = listResearch(db)[0];
    expect(result.headers.get("Location")).toBe(`/research/${run.id}`);
    expect(run).toMatchObject({
      status: "queued",
      budget_usd: 0,
      input: { query: values.query },
      settings: {
        countries: ["US", "DE"],
        reviewCandidates: true,
        crossPlatform: true,
        direction: "android_to_ios",
      },
    });
  });
  test("invalid fields are returned with submitted data and no run", async () => {
    const result = await workspaceAction(
      request({
        ...values,
        query: "",
        urls: "javascript:alert(1)",
        countries: "United States",
        appLimit: "-1",
      }),
      ["create"],
      undefined,
      db,
    );
    expect(result instanceof Response).toBe(false);
    if (result instanceof Response) return;
    expect(result.data.errors).toHaveProperty("urls");
    expect(result.data.errors).toHaveProperty("countries");
    expect(result.data.errors).toHaveProperty("appLimit");
    expect(result.data.values?.countries).toBe("United States");
    expect(listResearch(db)).toHaveLength(0);
  });
  test("category mode maps installed IDs and rejects unlisted categories", () => {
    const parsed = parseResearchForm(
      { ...values, mode: "category", categories: ["Productivity"] },
      {},
    );
    expect(parsed.input.categories).toEqual([
      { label: "Productivity", apple: "6007", google: "PRODUCTIVITY" },
    ]);
    expect(() =>
      parseResearchForm(
        { ...values, mode: "category", categories: ["Injected"] },
        {},
      ),
    ).toThrow(FormError);
  });
  test("settings persist appearance, model and defaults without secrets", async () => {
    const model = readSettings(db).models[0];
    const result = await workspaceAction(
      request({ ...values, intent: "settings", appearance: "dark", model }),
      ["settings"],
      undefined,
      db,
    );
    expect(result instanceof Response).toBe(false);
    expect(readSettings(db)).toMatchObject({
      appearance: "dark",
      model,
      defaults: { budgetUsd: 0, countries: ["US", "DE"] },
    });
    const rejected = await workspaceAction(
      request({
        ...values,
        intent: "settings",
        appearance: "dark",
        model: "invalid",
      }),
      ["settings"],
      undefined,
      db,
    );
    if (!(rejected instanceof Response))
      expect(rejected.data.errors?.model).toBeDefined();
  });
  test("cross-origin, non-POST, oversized and unavailable actions are safe", async () => {
    const external = await workspaceAction(
      request(values, "https://outside.invalid"),
      ["create"],
      undefined,
      db,
    );
    if (!(external instanceof Response))
      expect(external.init?.status).toBe(403);
    const get = await workspaceAction(
      new Request("http://localhost:5173"),
      ["create"],
      undefined,
      db,
    );
    if (!(get instanceof Response)) expect(get.init?.status).toBe(405);
    const large = await workspaceAction(
      request({ ...values, query: "a".repeat(70_000) }),
      ["create"],
      undefined,
      db,
    );
    if (!(large instanceof Response))
      expect(large.data.errors?.form).toContain("too large");
    const action = await workspaceAction(
      request({ intent: "destroy_all" }),
      ["create"],
      undefined,
      db,
    );
    if (!(action instanceof Response))
      expect(action.data.errors?.form).toContain("unavailable");
    expect(listResearch(db)).toHaveLength(0);
  });
  test("pause and resume follow real run state; state errors reveal no stack", async () => {
    const id = createResearch(
      db,
      { mode: "topic", query: "Sample" },
      defaultResearchSettings(),
    );
    await workspaceAction(request({ intent: "pause" }), ["pause"], id, db);
    expect(listResearch(db)[0]).toMatchObject({
      status: "paused",
      reason: "user",
    });
    await workspaceAction(request({ intent: "resume" }), ["resume"], id, db);
    expect(listResearch(db)[0].status).toBe("queued");
    await workspaceAction(request({ intent: "cancel" }), ["cancel"], id, db);
    expect(listResearch(db)[0].status).toBe("cancelled");
    await workspaceAction(request({ intent: "resume" }), ["resume"], id, db);
    expect(listResearch(db)[0].status).toBe("queued");
    const invalid = await workspaceAction(
      request({ intent: "continue" }),
      ["continue"],
      id,
      db,
    );
    if (!(invalid instanceof Response)) {
      expect(invalid.data.errors?.form).toContain("review has already ended");
      expect(JSON.stringify(invalid.data)).not.toContain("stack");
    }
  });
  test("saved status and Unicode notes persist and survive refresh", async () => {
    const runId = createResearch(
      db,
      { mode: "topic", query: "Sample saved report" },
      defaultResearchSettings(),
    );
    db.query("UPDATE runs SET status='completed' WHERE id=?").run(runId);
    db.query(
      "INSERT INTO opportunities(id,run_id,report_key,title,priority,confidence,report_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      "sample-opportunity",
      runId,
      "sample",
      "Sample saved",
      3,
      "low",
      JSON.stringify(SAMPLE_OPPORTUNITIES[0]),
      Date.now(),
    );
    const saveResult = await workspaceAction(
      request({ intent: "save", opportunityId: "sample-opportunity" }),
      ["save"],
      runId,
      db,
    );
    expect(saveResult instanceof Response).toBe(false);
    const savedId = saveOpportunity(db, "sample-opportunity");
    const notes =
      "Sample notes: Überprüfen 日本語 العربية <script>not executable</script>";
    await workspaceAction(
      request({
        intent: "update_saved",
        id: savedId,
        status: "investigating",
        notes,
      }),
      ["update_saved"],
      undefined,
      db,
    );
    await workspaceAction(
      request({ intent: "refresh" }),
      ["refresh"],
      runId,
      db,
    );
    expect(listSaved(db)[0]).toMatchObject({
      status: "investigating",
      notes,
      run_id: runId,
    });
    const bad = await workspaceAction(
      request({
        intent: "update_saved",
        id: savedId,
        status: "automatic",
        notes,
      }),
      ["update_saved"],
      undefined,
      db,
    );
    if (!(bad instanceof Response)) {
      expect(bad.data.errors?.status).toBeDefined();
      expect(bad.data.values?.notes).toBe(notes);
    }
    const html = render(<Saved />, { saved: listSaved(db) });
    expect(html).toContain("Investigating");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(`opportunity=sample-opportunity`);
  });
});
describe("rendered workspace state contracts", () => {
  test("cancelled research offers explicit checkpoint resume as well as a new refresh", () => {
    const html = render(
      <ProgressPanel
        progress={{ ...SAMPLE_PROGRESS, status: "cancelled", reason: "user" }}
        ceiling={1}
      />,
    );
    expect(html).toContain('value="resume"');
    expect(html).toContain('value="refresh"');
    expect(html).not.toContain('value="cancel"');
  });
  test("form errors remain associated with fields and preserve values", () => {
    const html = render(
      <NewResearchForm
        defaults={defaultResearchSettings()}
        result={{
          values: { ...values, query: "Sample preserved" },
          errors: {
            query: "Choose a clearer question",
            countries: "Country error",
          },
        }}
      />,
    );
    expect(html).toContain("Sample preserved");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="query-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("United States · Germany");
  });
  test("mode radios and direction select identify their validation errors", () => {
    const html = render(
      <NewResearchForm
        defaults={defaultResearchSettings()}
        result={{
          values,
          errors: {
            mode: "Choose a research mode",
            direction: "Choose a direction",
          },
        }}
      />,
    );
    expect(html.match(/aria-describedby="mode-error"/g)).toHaveLength(2);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(3);
    expect(html).toContain('aria-describedby="direction-hint direction-error"');
    expect(html).toContain('id="mode-error"');
    expect(html).toContain('id="direction-error"');
  });
  test("report selection and claims reference real stored source anchors", () => {
    const url = opportunityUrl(
      "/research/sample",
      "sample-offline",
      "sample-review-1",
    );
    expect(url).toBe(
      "/research/sample?opportunity=sample-offline&source=sample-review-1#source-sample-review-1",
    );
    const html = render(
      <ReportWorkspace
        opportunities={SAMPLE_OPPORTUNITIES}
        sources={SAMPLE_SOURCES}
        base="/reference"
        selectedId="sample-offline"
        selectedSource="sample-review-1"
        complete={false}
        sample
      />,
    );
    expect(html).toContain(`id="${sourceAnchor("sample-review-1")}"`);
    expect(html).toContain("source-selected");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Translation · English");
    expect(html).toContain("買い物中");
    expect(html).toContain("Counterevidence");
    expect(html).toContain("Sample opportunity");
    expect(html).not.toContain("play.google.com");
  });
  test("evidence shows stored request provenance and never invents a detected language", () => {
    const source = {
      ...SAMPLE_SOURCES[1],
      provenance_json: JSON.stringify({ requestedCountry: "DE", requestedLanguage: "fr" }),
      payload: { ...SAMPLE_SOURCES[1].payload, country: "US", language: "en", detectedLanguage: "de" },
    };
    const html = render(
      <OpportunityDetail
        opportunity={SAMPLE_OPPORTUNITIES[0]}
        sources={[source]}
        base="/reference"
        saveEnabled={false}
      />,
    );
    const visible = html.replaceAll("<!-- -->", "");
    expect(visible).toContain("Requested storefront: DE");
    expect(visible).toContain("Requested language: fr");
    expect(visible).toContain("Detected language: de");
    const unknown = render(
      <OpportunityDetail opportunity={{ ...SAMPLE_OPPORTUNITIES[0], evidence: [] }} sources={[{ ...source, payload: { ...source.payload, detectedLanguage: null } }]} base="/reference" saveEnabled={false} />,
    );
    expect(unknown.replaceAll("<!-- -->", "")).toContain("Detected language: Unknown");
  });
  test("coverage names requested language streams and recorded gaps without author inferences", () => {
    const view = {
      run: {
        coverage: "gaps",
        coverageDetails: { gaps: [{ key: "stream-de", reason: "Review collection stopped: access_failure" }] },
        settings: { countries: ["US", "DE"], stores: ["apple"], appLimit: 10, reviewLimit: 20 },
      },
      tasks: [
        { id: "stream-us", kind: "review_stream", status: "completed", error_code: null, checkpoint: { store: "apple", country: "US", language: "en", pages: 1, stopReason: "exhausted" } },
        { id: "stream-de", kind: "review_stream", status: "completed", error_code: null, checkpoint: { store: "apple", country: "DE", language: "de", pages: 0, stopReason: "request_limit" } },
      ],
      sources: [{ ...SAMPLE_SOURCES[1], task_id: "stream-us" }],
      report: null,
    } as unknown as ResearchView;
    const html = render(<CoverageDetails view={view} />);
    const visible = html.replaceAll("<!-- -->", "");
    expect(visible).toContain("Requested collection language streams:");
    expect(visible).toContain("requested storefront US · requested language en · represented (1 stored review snapshot)");
    expect(visible).toContain("requested storefront DE · requested language de · not visited (request_limit)");
    expect(html).toContain("Review collection stopped: access_failure");
    expect(html).not.toContain("author residence");
  });
  test("skip navigation has visible focus styling", () => {
    const css = readFileSync(new URL("../app/styles/workspace.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.skip-link:focus\s*\{[^}]*top:\s*12px/);
    expect(css).toMatch(/\.main-content:focus\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
    expect(css).not.toMatch(/\.main-content:focus\s*\{[^}]*outline:\s*none/);
  });
  test("hostile source URLs are never linked and quotations stay escaped", () => {
    const source = {
      ...SAMPLE_SOURCES[1],
      url: "javascript:alert(1)",
      payload: { text: "<script>bad</script>" },
    };
    const html = render(
      <OpportunityDetail
        opportunity={{ ...SAMPLE_OPPORTUNITIES[0], evidence: [] }}
        sources={[source]}
        base="/reference"
        saveEnabled={false}
      />,
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(html).toContain("No source URL captured");
  });
  test("recovery, worker distinctions, partial and uncertainty are explicit", () => {
    expect(
      runLabel({ status: "queued", reason: null }, "not_responding"),
    ).toContain("not responding");
    expect(
      runLabel({ status: "queued", reason: null }, "not_running"),
    ).toContain("not running");
    const interrupted = render(
      <ProgressPanel progress={SAMPLE_PROGRESS} ceiling={1} />,
    );
    expect(interrupted).toContain("Research was interrupted");
    expect(interrupted).toContain("Resume");
    expect(interrupted).not.toContain("%");
    const budget = render(
      <ProgressPanel
        progress={{
          ...SAMPLE_PROGRESS,
          reason: "budget",
          budget: { ...SAMPLE_PROGRESS.budget, unknown: true },
        }}
        ceiling={1}
      />,
    );
    expect(budget).toContain("Provider cost is uncertain");
    expect(budget).toContain("disabled");
    expect(
      render(
        <Notice title="Completed with gaps">
          Missing sources remain unknown.
        </Notice>,
      ),
    ).toContain("Missing sources remain unknown");
  });
  test("theme initialization follows server preference and system before hydration", () => {
    const evaluate = (appearance: string, dark: boolean) => {
      const document = {
        documentElement: { dataset: {} as Record<string, string> },
      };
      new Function("document", "matchMedia", themeScript(appearance))(
        document,
        () => ({ matches: dark }),
      );
      return document.documentElement.dataset.theme;
    };
    expect(evaluate("system", true)).toBe("dark");
    expect(evaluate("system", false)).toBe("light");
    expect(evaluate("dark", false)).toBe("dark");
    expect(evaluate("light", true)).toBe("light");
    expect(themeScript("</script>")).not.toContain("</script>");
  });
});
describe("progress polling lifecycle", () => {
  test("polls one request at a time and stops at a paused state", async () => {
    let calls = 0;
    let concurrent = 0;
    let maximum = 0;
    const states: string[] = [];
    const fetcher = (async () => {
      calls++;
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await Bun.sleep(8);
      concurrent--;
      return Response.json({
        ...SAMPLE_PROGRESS,
        status: calls === 1 ? "running" : "paused",
      });
    }) as unknown as typeof fetch;
    const stop = startProgressPolling(
      "/progress",
      {
        onProgress: (value) => states.push(value.status),
        onError: () => {
          throw new Error("Unexpected error");
        },
      },
      { interval: 2, fetcher, visible: () => true },
    );
    await Bun.sleep(60);
    stop();
    expect(states).toEqual(["running", "paused"]);
    expect(calls).toBe(2);
    expect(maximum).toBe(1);
  });
  test("unmount aborts in-flight work and ignores late responses", async () => {
    let signal: AbortSignal | null = null;
    let updates = 0;
    const fetcher = (async (_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      await Bun.sleep(15);
      return Response.json(SAMPLE_PROGRESS);
    }) as unknown as typeof fetch;
    const stop = startProgressPolling(
      "/progress",
      { onProgress: () => updates++, onError: () => updates++ },
      { interval: 1, fetcher, visible: () => true },
    );
    await Bun.sleep(5);
    stop();
    await Bun.sleep(25);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(updates).toBe(0);
  });
  test("hidden pages wait and failed reads offer recovery without inventing progress", async () => {
    let visible = false;
    let calls = 0;
    let errors = 0;
    const fetcher = (async () => {
      calls++;
      return new Response("unavailable", { status: 503 });
    }) as unknown as typeof fetch;
    const stop = startProgressPolling(
      "/progress",
      {
        onProgress: () => {
          throw new Error("No valid progress");
        },
        onError: () => errors++,
      },
      { interval: 2, fetcher, visible: () => visible },
    );
    await Bun.sleep(10);
    expect(calls).toBe(0);
    visible = true;
    await Bun.sleep(12);
    stop();
    expect(calls).toBeGreaterThan(0);
    expect(errors).toBe(calls);
  });
  test("becoming visible or focused refreshes active progress immediately", async () => {
    let calls = 0;
    let concurrent = 0;
    let maximum = 0;
    const events = { document: new EventTarget(), window: new EventTarget() };
    const fetcher = (async () => {
      calls++;
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await Bun.sleep(8);
      concurrent--;
      return Response.json({ ...SAMPLE_PROGRESS, status: "running" });
    }) as unknown as typeof fetch;
    const stop = startProgressPolling(
      "/progress",
      { onProgress: () => {}, onError: () => {} },
      { interval: 1000, fetcher, visible: () => true, events },
    );
    events.document.dispatchEvent(new Event("visibilitychange"));
    await Bun.sleep(15);
    expect(calls).toBe(1);
    events.window.dispatchEvent(new Event("focus"));
    await Bun.sleep(15);
    stop();
    expect(calls).toBe(2);
    expect(maximum).toBe(1);
  });
});
