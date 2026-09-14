import { randomUUID } from "node:crypto";
import { transaction, type DB } from "./db";
import { createTask, getTask } from "./runs";
import type { CollectionCheckpoint } from "./policy";
import { decodeObject, type JsonObject } from "../shared/types";

export function parseCollectionCheckpoint(json: string): CollectionCheckpoint {
  const value = decodeObject(json);
  for (const key of ["version", "scopeHash"] as const) if (typeof value[key] !== "string" || !value[key]) throw new Error(`Invalid collection ${key}`);
  for (const key of ["startedAt", "quota", "uniqueCount", "pages", "requestAttempts", "noNewIdPages"] as const) if (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error(`Invalid collection ${key}`);
  if (value.endedAt !== null && (typeof value.endedAt !== "number" || !Number.isSafeInteger(value.endedAt))) throw new Error("Invalid collection end time");
  if (value.cursor !== null && typeof value.cursor !== "string") throw new Error("Invalid collection cursor");
  if (value.stopReason !== null && typeof value.stopReason !== "string") throw new Error("Invalid collection stop reason");
  if (typeof value.complete !== "boolean" || !Array.isArray(value.seenCursors) || !value.seenCursors.every(c => typeof c === "string")) throw new Error("Invalid collection state");
  return value as unknown as CollectionCheckpoint;
}

// Retain the earlier segment and its source observations; the replacement starts at page one.
// saveSource transfers the representative only when replacement evidence is selected,
// so a failed refresh can still expose the older observation with its original date.
export function replaceCollectionTask(db: DB, oldId: string, reason: "stale" | "cursor_invalid", now = Date.now()): string {
  return transaction(db, () => {
    const old = getTask(db, oldId);
    if (old.stage !== "collection") throw new Error("Only collection segments can be replaced");
    const checkpoint = parseCollectionCheckpoint(old.checkpoint_json);
    const key = `replacement:${old.id}`;
    const existing = db.query<{ id: string }, [string, string]>("SELECT id FROM tasks WHERE run_id=? AND stage='collection' AND dedupe_key=?").get(old.run_id, key);
    if (existing) return existing.id;
    const replacement: JsonObject = { ...checkpoint, version: randomUUID(), startedAt: now, endedAt: null, pages: 0, requestAttempts: 0, pageAttempts: 0, pageRequests: [], noNewIdPages: 0, uniqueCount: 0, cursor: null, seenCursors: [], stopReason: null, complete: false, previousTaskId: old.id, replacementReason: reason };
    db.query("UPDATE tasks SET status='superseded',attempt_id=NULL,updated_at=? WHERE id=?").run(now, old.id);
    return createTask(db, old.run_id, "collection", key, old.kind, replacement, now);
  });
}

// Replacements retain earlier request counts, including retries, in the run-wide safety bound.
export function collectionRequestCount(db: DB, runId: string): number {
  return db.query<{ checkpoint_json: string }, [string]>("SELECT checkpoint_json FROM tasks WHERE run_id=? AND stage='collection'").all(runId).reduce((sum, row) => sum + parseCollectionCheckpoint(row.checkpoint_json).requestAttempts, 0);
}
