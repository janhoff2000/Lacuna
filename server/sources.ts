import { createHash, randomUUID } from "node:crypto";
import { transaction, type DB } from "./db";
import { decodeObject, encodeJson, type JsonObject, type Store } from "../shared/types";
import { getTask } from "./runs";
import { recordAvailability, recordListing } from "./catalog";

export interface SourceSnapshot {
  kind: "listing" | "review" | "website"; store?: Store; appId?: string; reviewId?: string;
  url: string; locale: string; payload: JsonObject; capturedAt: number;
  // Until the collector identity trial passes, review IDs remain untrusted and uncounted.
  identityVerified?: boolean;
}
// Use within checkpointTask/completeTask to commit sources and cursor/result together.
// A standalone call is also atomic, including changes to the counted representative.
export function saveSource(db: DB, runId: string, taskId: string, version: string, snapshot: SourceSnapshot, provenance: JsonObject, selected = false): string {
  const save = () => saveSourceInTransaction(db, runId, taskId, version, snapshot, provenance, selected);
  return db.inTransaction ? save() : transaction(db, save);
}

export function reviewDisqualified(db: DB, runId: string, store: Store, appId: string, reviewId: string): boolean {
  return !!db.query("SELECT rs.id FROM run_sources rs JOIN sources s ON s.id=rs.source_id WHERE rs.run_id=? AND s.store=? AND s.app_id=? AND s.review_id=? AND json_extract(rs.provenance_json,'$.identityDisqualified')=1 LIMIT 1").get(runId, store, appId, reviewId);
}

// The persisted observation links carry the disqualification, so later pages,
// locale streams, replacements and cache reuse cannot silently restore trust.
export function disqualifyReview(db: DB, runId: string, store: Store, appId: string, reviewId: string): void {
  const write = () => {
    const rows = db.query<{ id: string; provenance_json: string }, [string,Store,string,string]>("SELECT rs.id,rs.provenance_json FROM run_sources rs JOIN sources s ON s.id=rs.source_id WHERE rs.run_id=? AND s.store=? AND s.app_id=? AND s.review_id=?").all(runId, store, appId, reviewId);
    for (const row of rows) db.query("UPDATE run_sources SET selected=0,counted=0,logical_review_key=NULL,provenance_json=? WHERE id=?").run(encodeJson({ ...decodeObject(row.provenance_json), identityDisqualified: true, identityReason: "conflicting_review_content" }), row.id);
  };
  if (db.inTransaction) write(); else transaction(db, write);
}

function saveSourceInTransaction(db: DB, runId: string, taskId: string, version: string, snapshot: SourceSnapshot, provenance: JsonObject, selected: boolean): string {
  if (getTask(db, taskId).run_id !== runId) throw new Error("Source task belongs to another run");
  if (snapshot.kind !== "website" && (!snapshot.store || !snapshot.appId)) throw new Error("Store listing identity required");
  const disqualified = snapshot.kind === "review" && !!snapshot.reviewId && (snapshot.payload.identityReason === "conflicting_review_content" || reviewDisqualified(db, runId, snapshot.store!, snapshot.appId!, snapshot.reviewId));
  if (disqualified) provenance = { ...provenance, identityDisqualified: true, identityReason: "conflicting_review_content" };
  const logicalKey = snapshot.kind === "review" && !disqualified && snapshot.identityVerified && snapshot.reviewId ? encodeJson([snapshot.store, snapshot.appId, snapshot.reviewId]) : null;
  if (selected && !logicalKey) throw new Error("Unverified review identity cannot count as selected evidence");
  const identity = snapshot.kind === "review" ? logicalKey ?? `quarantined:${randomUUID()}` : snapshot.kind === "listing" ? encodeJson([snapshot.store, snapshot.appId]) : snapshot.url;
  const payload = encodeJson(snapshot.payload);
  const hash = createHash("sha256").update(payload).digest("hex");
  db.query("INSERT INTO sources(id,kind,identity_key,store,app_id,review_id,locale,url,content_hash,payload_json,captured_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,identity_key,content_hash,locale) DO NOTHING").run(randomUUID(), snapshot.kind, identity, snapshot.store ?? null, snapshot.appId ?? null, snapshot.reviewId ?? null, snapshot.locale, snapshot.url, hash, payload, snapshot.capturedAt);
  const source = db.query<{ id: string }, [string,string,string,string]>("SELECT id FROM sources WHERE kind=? AND identity_key=? AND content_hash=? AND locale=?").get(snapshot.kind, identity, hash, snapshot.locale)!;
  if (snapshot.kind === "listing") {
    // Every captured listing page feeds the cross-run app catalog in the same transaction.
    const p = snapshot.payload; const text = (value: unknown) => typeof value === "string" ? value : "";
    const country = text(p.country);
    recordListing(db, { store: snapshot.store!, appId: snapshot.appId!, title: text(p.title), description: text(p.description), developer: text(p.developer), developerId: text(p.developerId), category: text(p.category) || null, country, language: text(p.language) }, snapshot.capturedAt, source.id);
    if (/^[A-Z]{2}$/.test(country)) recordAvailability(db, snapshot.store!, snapshot.appId!, country, "available", snapshot.capturedAt);
  }
  const counted = logicalKey && !db.query("SELECT id FROM run_sources WHERE run_id=? AND logical_review_key=? AND counted=1").get(runId, logicalKey) ? 1 : 0;
  db.query("INSERT INTO run_sources(id,run_id,source_id,task_id,collection_version,logical_review_key,selected,counted,provenance_json,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,source_id,task_id) DO NOTHING").run(randomUUID(), runId, source.id, taskId, version, logicalKey, selected && counted ? 1 : 0, counted, encodeJson(provenance), snapshot.capturedAt);
  if (selected && logicalKey) {
    // Selection names the intended observation, which may contain newer content
    // from a replacement segment. Retain earlier versions without counting them.
    db.query("UPDATE run_sources SET selected=0,counted=0 WHERE run_id=? AND logical_review_key=? AND counted=1").run(runId, logicalKey);
    db.query("UPDATE run_sources SET selected=1,counted=1 WHERE run_id=? AND source_id=? AND task_id=?").run(runId, source.id, taskId);
  }
  return source.id;
}
