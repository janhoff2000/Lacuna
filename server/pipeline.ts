import type { DB } from "./db";
import { transaction } from "./db";
import { createTask, getRun, transitionInTransaction, type RunRow, type TaskRow } from "./runs";
import { decodeObject, parseRunSettings, type JsonObject, type Stage } from "../shared/types";

export interface TaskSpec { key: string; kind?: string; checkpoint?: JsonObject }
export type StagePlanner = (run: RunRow, stage: Stage) => TaskSpec[];
export type TaskHandler = (task: TaskRow, signal: AbortSignal) => Promise<JsonObject>;
export type Handlers = Partial<Record<Stage, TaskHandler>>;

function nextStage(stage: Stage): Stage | null {
  switch (stage) {
    case "discovery": return "candidate_review";
    case "candidate_review": return "collection";
    case "collection": return "analysis";
    case "analysis": return "grouping";
    case "grouping": return "verification";
    case "verification": return "report";
    case "report": return null;
  }
}
// Fixed stages; the integration supplies stream/batch/check keys, not a dependency graph.
export function advancePipeline(db: DB, runId: string, planner: StagePlanner = (_run, stage) => [{ key: stage }], now = Date.now()): void {
  transaction(db, () => {
    let run = getRun(db, runId);
    if (run.status !== "running") return;
    const settings = parseRunSettings(decodeObject(run.settings_json));
    const tasks = db.query<TaskRow, [string, string]>("SELECT * FROM tasks WHERE run_id=? AND stage=? AND status!='superseded'").all(runId, run.stage);
    if (tasks.some(task => task.status !== "completed")) return;
    if (tasks.length) {
      const noMatchingApps = run.stage === "discovery" && tasks.some(task => task.result_json && decodeObject(task.result_json).noMatchingApps === true);
      const next = noMatchingApps ? "report" : nextStage(run.stage);
      if (!next) { transitionInTransaction(db, run.id, "completed", null, now); return; }
      db.query("UPDATE runs SET stage=?,updated_at=? WHERE id=?").run(next, now, run.id);
      run = getRun(db, run.id);
      if (noMatchingApps) {
        createTask(db, run.id, "report", "no-matching-apps", "no_matching_apps", { message: "No matching apps were found. Adjust the need, selected stores or countries and try again." }, now);
        return;
      }
    }
    if (run.stage === "candidate_review") {
      if (settings.reviewCandidates) { transitionInTransaction(db, run.id, "paused", "app_review", now); return; }
      db.query("UPDATE runs SET stage='collection',updated_at=? WHERE id=?").run(now, run.id);
      run = getRun(db, run.id);
    }
    const specs = planner(run, run.stage);
    if (!specs.length) throw new Error("A stage must declare work or an explicit no-data task");
    for (const spec of specs) createTask(db, run.id, run.stage, spec.key, spec.kind, spec.checkpoint, now);
  });
}
