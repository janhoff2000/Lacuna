import type { DB } from "./db";
import { decodeObject, encodeJson, type JsonObject, type Store } from "../shared/types";

// The catalog accumulates across runs: what each observed app is, in which
// storefronts it was found or confirmed missing, and earlier transfer verdicts.
export interface CatalogListing { store: Store; appId: string; title: string; description: string; developer: string; developerId: string; category: string | null; country: string; language: string }
export interface CatalogApp extends CatalogListing { detail: boolean; sourceId: string | null; summary: string | null; firstSeenAt: number; updatedAt: number }
export type KnownAvailability = { status: "available" | "unavailable"; checkedAt: number };

// A chart or search row never replaces text read from a full listing page, and
// an older observation never replaces a newer one.
export function recordListing(db: DB, listing: CatalogListing, capturedAt: number, sourceId: string | null = null): void {
  if (!listing.title.trim()) return;
  db.query(`INSERT INTO apps(store,app_id,title,developer,developer_id,category,description,country,language,detail,source_id,first_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(store,app_id) DO UPDATE SET title=excluded.title,developer=excluded.developer,developer_id=excluded.developer_id,category=COALESCE(excluded.category,apps.category),description=excluded.description,country=excluded.country,language=excluded.language,detail=excluded.detail,source_id=excluded.source_id,updated_at=excluded.updated_at
    WHERE excluded.detail>=apps.detail AND excluded.updated_at>=apps.updated_at`)
    .run(listing.store, listing.appId, listing.title, listing.developer, listing.developerId, listing.category, listing.description, listing.country, listing.language, sourceId ? 1 : 0, sourceId, capturedAt, capturedAt);
}
export function recordSummary(db: DB, store: Store, appId: string, summary: string): void {
  if (summary.trim()) db.query("UPDATE apps SET summary=? WHERE store=? AND app_id=?").run(summary.trim().slice(0, 500), store, appId);
}
export function catalogApp(db: DB, store: Store, appId: string): CatalogApp | null {
  const row = db.query<{ store: Store; app_id: string; title: string; developer: string; developer_id: string; category: string | null; description: string; country: string; language: string; detail: number; source_id: string | null; summary: string | null; first_seen_at: number; updated_at: number }, [Store, string]>("SELECT * FROM apps WHERE store=? AND app_id=?").get(store, appId);
  return row ? { store: row.store, appId: row.app_id, title: row.title, developer: row.developer, developerId: row.developer_id, category: row.category, description: row.description, country: row.country, language: row.language, detail: row.detail === 1, sourceId: row.source_id, summary: row.summary, firstSeenAt: row.first_seen_at, updatedAt: row.updated_at } : null;
}

// Callers pass only definitive storefront answers; a failed check is not an observation.
export function recordAvailability(db: DB, store: Store, appId: string, country: string, status: KnownAvailability["status"], checkedAt: number): void {
  db.query("INSERT INTO app_availability(store,app_id,country,status,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(store,app_id,country) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at WHERE excluded.checked_at>=app_availability.checked_at").run(store, appId, country, status, checkedAt);
}
export function knownAvailability(db: DB, store: Store, appId: string, country: string, now: number, freshness: Record<KnownAvailability["status"], number>): KnownAvailability | null {
  const row = db.query<{ status: KnownAvailability["status"]; checked_at: number }, [Store, string, string]>("SELECT status,checked_at FROM app_availability WHERE store=? AND app_id=? AND country=?").get(store, appId, country);
  return row && row.checked_at <= now && now - row.checked_at < freshness[row.status] ? { status: row.status, checkedAt: row.checked_at } : null;
}

export interface ScreeningKey { store: Store; appId: string; sourceCountry: string; targetCountry: string; inputHash: string }
export function recordScreening(db: DB, key: ScreeningKey, result: JsonObject, screenedAt: number): void {
  db.query("INSERT INTO transfer_screenings(store,app_id,source_country,target_country,input_hash,result_json,screened_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(store,app_id,source_country,target_country,input_hash) DO UPDATE SET result_json=excluded.result_json,screened_at=excluded.screened_at").run(key.store, key.appId, key.sourceCountry, key.targetCountry, key.inputHash, encodeJson(result), screenedAt);
}
export function knownScreening(db: DB, key: ScreeningKey): JsonObject | null {
  const row = db.query<{ result_json: string }, [Store, string, string, string, string]>("SELECT result_json FROM transfer_screenings WHERE store=? AND app_id=? AND source_country=? AND target_country=? AND input_hash=?").get(key.store, key.appId, key.sourceCountry, key.targetCountry, key.inputHash);
  return row ? decodeObject(row.result_json) : null;
}
