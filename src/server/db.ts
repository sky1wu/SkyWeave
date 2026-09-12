import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

const filename = process.env.DATABASE_PATH || "./data/trip-planner.sqlite";
mkdirSync(dirname(resolve(/* turbopackIgnore: true */ filename)), {
  recursive: true,
});
const globalDb = globalThis as typeof globalThis & {
  tripSqlite?: Database.Database;
};
export const sqlite = globalDb.tripSqlite ?? new Database(filename);
globalDb.tripSqlite = sqlite;
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
export const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: resolve("drizzle") });

type Param = string | number | null;
const jsonFields = new Set(["polyline", "steps", "splitMeta", "transport"]);
const booleanFields = new Set([
  "fixedTime",
  "geometryComplete",
  "emailVerified",
]);
function decode<T>(row: unknown): T {
  const data = row as Record<string, unknown>;
  for (const field of Object.keys(data)) {
    if (jsonFields.has(field) && typeof data[field] === "string")
      data[field] = JSON.parse(data[field] as string);
    if (booleanFields.has(field)) data[field] = Boolean(data[field]);
  }
  return data as T;
}
export function one<T>(query: string, ...params: Param[]): T | undefined {
  const row = sqlite.prepare(query).get(...params);
  return row ? decode<T>(row) : undefined;
}
export function many<T>(query: string, ...params: Param[]): T[] {
  return sqlite
    .prepare(query)
    .all(...params)
    .map(decode<T>);
}
export function run(query: string, ...params: Param[]) {
  return sqlite.prepare(query).run(...params);
}
export function insert(table: string, data: Record<string, unknown>) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const values = entries.map(([k, v]): Param =>
    v === null
      ? null
      : jsonFields.has(k)
        ? JSON.stringify(v)
        : typeof v === "boolean"
          ? Number(v)
          : (v as Param),
  );
  run(
    `INSERT INTO ${table} (${entries.map(([k]) => `"${k}"`).join(",")}) VALUES (${entries.map(() => "?").join(",")})`,
    ...values,
  );
}
export function update(
  table: string,
  id: string,
  data: Record<string, unknown>,
) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const values = entries.map(([k, v]): Param =>
    v === null
      ? null
      : jsonFields.has(k)
        ? JSON.stringify(v)
        : typeof v === "boolean"
          ? Number(v)
          : (v as Param),
  );
  run(
    `UPDATE ${table} SET ${entries.map(([k]) => `"${k}" = ?`).join(",")} WHERE id = ?`,
    ...values,
    id,
  );
}
