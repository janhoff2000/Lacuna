import { databasePath, openDatabase } from "../server/db";

const db = openDatabase();
console.info(`Database ready: ${databasePath()} (schema ${db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version})`);
db.close();
