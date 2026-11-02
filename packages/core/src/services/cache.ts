import Database from "better-sqlite3";
import { Context, Effect, Layer, type Scope } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { paths } from "../config/load";
import type { Activity, DateWindow } from "../domain/activity";
import { CacheError } from "../errors";
export interface CachedSummary {
  readonly text: string;
  readonly model: string;
  readonly createdAt: Date;
}
export interface CacheShape {
  readonly saveActivities: (activities: readonly Activity[]) => Effect.Effect<void, CacheError>;
  readonly activities: (window: DateWindow) => Effect.Effect<Activity[], CacheError>;
  readonly summary: (hash: string) => Effect.Effect<CachedSummary | undefined, CacheError>;
  readonly saveSummary: (
    hash: string,
    s: Omit<CachedSummary, "createdAt">,
  ) => Effect.Effect<void, CacheError>;
  readonly edit: (briefKey: string) => Effect.Effect<string | undefined, CacheError>;
  readonly saveEdit: (briefKey: string, text: string) => Effect.Effect<void, CacheError>;
  readonly clearEdit: (briefKey: string) => Effect.Effect<void, CacheError>;
}
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE activities (
     id TEXT PRIMARY KEY,
     source TEXT NOT NULL,
     type TEXT NOT NULL,
     timestamp INTEGER NOT NULL,
     end_ts INTEGER,
     title TEXT NOT NULL,
     description TEXT,
     project TEXT,
     url TEXT,
     metadata TEXT NOT NULL,
     seen_at INTEGER NOT NULL
   );
   CREATE INDEX activities_ts ON activities (timestamp);
   CREATE TABLE summaries (hash TEXT PRIMARY KEY, text TEXT NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE edits (brief_key TEXT PRIMARY KEY, text TEXT NOT NULL, updated_at INTEGER NOT NULL);`,
];
const migrate = (db: Database.Database) => {
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
};
interface ActivityRow {
  id: string;
  source: Activity["source"];
  type: Activity["type"];
  timestamp: number;
  end_ts: number | null;
  title: string;
  description: string | null;
  project: string | null;
  url: string | null;
  metadata: string;
}
export const makeCache = (file: string): Effect.Effect<CacheShape, CacheError, Scope.Scope> =>
  Effect.gen(function* () {
    const db = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const db = new Database(file);
          db.pragma("journal_mode = WAL");
          db.pragma("busy_timeout = 3000");
          migrate(db);
          return db;
        },
        catch: (e) =>
          new CacheError({ message: `can't open cache at ${file}: ${String(e)}`, cause: e }),
      }),
      (db) => Effect.sync(() => db.close()),
    );
    const run = <A>(f: () => A) =>
      Effect.try({ try: f, catch: (e) => new CacheError({ message: String(e), cause: e }) });
    const upsert =
      db.prepare(`INSERT INTO activities (id, source, type, timestamp, end_ts, title, description, project, url, metadata, seen_at)
       VALUES (@id, @source, @type, @timestamp, @end_ts, @title, @description, @project, @url, @metadata, @seen_at)
       ON CONFLICT(id) DO UPDATE SET
         timestamp = excluded.timestamp, end_ts = excluded.end_ts, title = excluded.title,
         description = excluded.description, project = excluded.project, url = excluded.url,
         metadata = excluded.metadata, seen_at = excluded.seen_at`);
    const saveMany = db.transaction((rows: readonly Activity[]) => {
      const now = Date.now();
      for (const a of rows) {
        upsert.run({
          id: a.id,
          source: a.source,
          type: a.type,
          timestamp: a.timestamp.getTime(),
          end_ts: a.end?.getTime() ?? null,
          title: a.title,
          description: a.description ?? null,
          project: a.project ?? null,
          url: a.url ?? null,
          metadata: JSON.stringify(a.metadata),
          seen_at: now,
        });
      }
    });
    return {
      saveActivities: (activities) => run(() => saveMany(activities)),
      activities: (window) =>
        run(() =>
          (
            db
              .prepare(
                "SELECT * FROM activities WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp",
              )
              .all(window.start.getTime(), window.end.getTime()) as ActivityRow[]
          ).map((r): Activity => ({
            id: r.id,
            source: r.source,
            type: r.type,
            timestamp: new Date(r.timestamp),
            ...(r.end_ts !== null ? { end: new Date(r.end_ts) } : {}),
            title: r.title,
            ...(r.description !== null ? { description: r.description } : {}),
            ...(r.project !== null ? { project: r.project } : {}),
            ...(r.url !== null ? { url: r.url } : {}),
            metadata: JSON.parse(r.metadata) as Record<string, unknown>,
          })),
        ),
      summary: (hash) =>
        run(() => {
          const r = db
            .prepare("SELECT text, model, created_at FROM summaries WHERE hash = ?")
            .get(hash) as
            | {
                text: string;
                model: string;
                created_at: number;
              }
            | undefined;
          return r
            ? { text: r.text, model: r.model, createdAt: new Date(r.created_at) }
            : undefined;
        }),
      saveSummary: (hash, s) =>
        run(() => {
          db.prepare(`INSERT INTO summaries (hash, text, model, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(hash) DO UPDATE SET text = excluded.text, model = excluded.model, created_at = excluded.created_at`).run(
            hash,
            s.text,
            s.model,
            Date.now(),
          );
        }),
      edit: (key) =>
        run(
          () =>
            (
              db.prepare("SELECT text FROM edits WHERE brief_key = ?").get(key) as
                | {
                    text: string;
                  }
                | undefined
            )?.text,
        ),
      saveEdit: (key, text) =>
        run(() => {
          db.prepare(`INSERT INTO edits (brief_key, text, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(brief_key) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`).run(
            key,
            text,
            Date.now(),
          );
        }),
      clearEdit: (key) =>
        run(() => void db.prepare("DELETE FROM edits WHERE brief_key = ?").run(key)),
    } satisfies CacheShape;
  });
export class Cache extends Context.Tag("rundown/Cache")<Cache, CacheShape>() {
  static readonly Live = Layer.scoped(
    Cache,
    Effect.suspend(() => makeCache(path.join(paths.data, "rundown.db"))),
  );
  static readonly file = (file: string) => Layer.scoped(Cache, makeCache(file));
  static readonly memory = Layer.scoped(Cache, makeCache(":memory:"));
}
