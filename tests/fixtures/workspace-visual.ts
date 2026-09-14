// Explicit sample data for browser QA, never the normal workspace database.
// Run with: bun tests/fixtures/workspace-visual.ts /private/tmp/lacuna-task4-visual.sqlite
import { resolve } from "node:path";
import { openDatabase } from "../../server/db";
import { createResearch } from "../../server/operations";
import { defaultResearchSettings } from "../../server/research-input";
import { createTask } from "../../server/runs";
import { saveSource } from "../../server/sources";
import { SAMPLE_OPPORTUNITIES, SAMPLE_SOURCES } from "../../app/lib/sample";

if (!import.meta.main) throw new Error("Run this fixture explicitly.");
const path = resolve(process.argv[2] ?? "");
if (!path.startsWith("/private/tmp/lacuna-task4-"))
  throw new Error(
    "Use an explicit /private/tmp/lacuna-task4- sample database path.",
  );
const db = openDatabase(path);
try {
  const existing = db
    .query<{ id: string }, []>(
      "SELECT id FROM runs WHERE json_extract(input_json,'$.query')='Sample · Completed fixture report'",
    )
    .get();
  if (existing) {
    console.log({ existingSampleReport: existing.id });
    process.exit(0);
  }
  const now = Date.now();
  const run = createResearch(
    db,
    { mode: "topic", query: "Sample · Completed fixture report" },
    { ...defaultResearchSettings(), appLimit: 2 },
    0,
  );
  const task = createTask(db, run, "report", "sample-report");
  const sourceIds = new Map<string, string>();
  for (const source of SAMPLE_SOURCES) {
    const sourceId = saveSource(
      db,
      run,
      task,
      "sample-only",
      {
        kind: source.kind as "review" | "listing",
        store: "google",
        appId: source.app_id!,
        ...(source.review_id
          ? { reviewId: source.review_id, identityVerified: true }
          : {}),
        url: "",
        locale: "DE:de",
        payload: source.payload,
        capturedAt: source.captured_at,
      },
      { sample: true },
      false,
    );
    sourceIds.set(source.id, sourceId);
  }
  const report = {
    ...SAMPLE_OPPORTUNITIES[0],
    id: "sample-browser-opportunity",
    title: "Sample · Keep shared grocery lists useful offline",
    sampleCounts: { collected: 3, selected: 0, analyzed: 0 },
    denominator: 0,
    priority: 3,
    priorityReasons: [
      "Sample fixture only; no analyzed support",
      "No live product or developer count established",
      "Offline capability not verified",
    ],
    counts: {
      supportingReviews: 0,
      products: 0,
      developers: 0,
      recentReviews: 0,
    },
    status: "Sample fixture",
    sampleStatement:
      "Sample data for UI testing. No reviews were selected or analyzed by AI in this fixture.",
  };
  const mappedReport = JSON.parse(
    JSON.stringify(report, (_key, value) =>
      typeof value === "string" ? (sourceIds.get(value) ?? value) : value,
    ),
  );
  db.query("UPDATE tasks SET status='completed',result_json=? WHERE id=?").run(
    JSON.stringify({
      summary: "Sample fixture only. No live research was performed.",
      limitations: ["All contents are development samples."],
    }),
    task,
  );
  db.query(
    "UPDATE runs SET status='completed',stage='report',coverage='gaps',coverage_json=? WHERE id=?",
  ).run(
    JSON.stringify({
      gaps: [
        {
          key: "sample",
          reason: "Sample fixture only. No live research was performed.",
        },
      ],
    }),
    run,
  );
  db.query(
    "INSERT INTO opportunities(id,run_id,report_key,title,priority,confidence,report_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    "sample-browser-opportunity",
    run,
    "sample",
    report.title,
    3,
    "low",
    JSON.stringify(mappedReport),
    now,
  );

  const candidates = createResearch(
    db,
    { mode: "topic", query: "Sample · Candidate review fixture" },
    { ...defaultResearchSettings(), reviewCandidates: true, appLimit: 2 },
    0,
  );
  const candidateRows = ["sample.family", "sample.pantry"].map(
    (appId, index) => ({
      store: "google",
      appId,
      sourceId: "",
      country: "DE",
      language: "de",
      title: index
        ? "Sample · Pantry tracker"
        : "Sample · Family meal planning with a deliberately long app title",
      developerId: `sample:${index}`,
      rank: index,
      relevance: "direct",
      reason: "Sample listing description mentions shared meal planning.",
      included: true,
      intent: "Sample explicit inclusion",
      origins: ["Sample app listing"],
    }),
  );
  const discovery = createTask(
    db,
    candidates,
    "discovery",
    "sample-discovery",
    "discovery",
    {
      candidates: candidateRows,
      selected: candidateRows,
      lookups: 2,
      additions: [],
      seeds: [],
      completed: [],
    },
  );
  db.query("UPDATE tasks SET status='completed' WHERE id=?").run(discovery);
  db.query(
    "UPDATE runs SET status='paused',reason='app_review',stage='candidate_review' WHERE id=?",
  ).run(candidates);
  for (const reason of ["interrupted", "budget", "error"] as const) {
    const id = createResearch(
      db,
      { mode: "topic", query: `Sample · ${reason} recovery fixture` },
      defaultResearchSettings(),
      0,
    );
    db.query(
      "UPDATE runs SET status='paused',reason=?,stage='analysis' WHERE id=?",
    ).run(reason, id);
  }
  console.log({
    sampleReport: run,
    sampleOpportunity: "sample-browser-opportunity",
    candidateReview: candidates,
    note: "Fixture writes only; no worker or AI calls.",
  });
} finally {
  db.close();
}
