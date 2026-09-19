import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { decodeObject, encodeJson, type JsonObject } from "../shared/types";

export type DB = Database;
export function databasePath(path = process.env.LACUNA_DB_PATH ?? "data/lacuna.sqlite"): string {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  // Canonical parent path makes symlink aliases share one lock file.
  try { return realpathSync(absolute); } catch { return resolve(realpathSync(dirname(absolute)), absolute.split("/").at(-1)!); }
}

export function transaction<T>(db: DB, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    if (result instanceof Promise) throw new Error("Transactions must be synchronous; network work belongs outside them");
    db.exec("COMMIT");
    return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function openDatabase(path?: string): DB {
  const db = new Database(databasePath(path), { create: true, strict: true });
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    // Both entry points run from the repository root. A path relative to this
    // module would point inside build/server after React Router bundles it.
    const migrations = [resolve("server/migrations/001_foundation.sql"), resolve("server/migrations/002_research.sql"), resolve("server/migrations/003_parallel_analysis.sql"), resolve("server/migrations/004_parallel_ai_reservations.sql")];
    transaction(db, () => {
      const { user_version: current } = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!;
      if (current > migrations.length) throw new Error("Database belongs to a newer application version");
      for (let index = current; index < migrations.length; index++) {
        db.exec(readFileSync(migrations[index], "utf8"));
        db.exec(`PRAGMA user_version=${index + 1}`);
      }
    });
    return db;
  } catch (error) { db.close(); throw error; }
}

export function setSetting(db: DB, name: string, value: JsonObject, now = Date.now()): void {
  db.query("INSERT INTO settings(name,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(name, encodeJson(value), now);
}
export function getSetting(db: DB, name: string): JsonObject | null {
  const row = db.query<{ value_json: string }, [string]>("SELECT value_json FROM settings WHERE name=?").get(name);
  return row ? decodeObject(row.value_json) : null;
}
