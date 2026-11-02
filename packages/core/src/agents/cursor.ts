import Database from "better-sqlite3";
import { Effect } from "effect";
import * as os from "node:os";
import * as path from "node:path";
import type { DateWindow } from "../domain/activity";
import { attempt, detected, notDetected } from "../sources/source";
import { exists } from "../util/fs";
import type { AgentAdapter, AgentSession } from "./agent";
export const cursorDbCandidates = (home = os.homedir()): string[] => [
  path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
  path.join(
    home,
    "Library",
    "Application Support",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  ),
  ...(process.env.APPDATA
    ? [path.join(process.env.APPDATA, "Cursor", "User", "globalStorage", "state.vscdb")]
    : []),
];
interface Row {
  id: string;
  name: string | null;
  created: number | null;
  updated: number | null;
  prompts: number | null;
}
const QUERY = `
  SELECT json_extract(value, '$.composerId') AS id,
         json_extract(value, '$.name') AS name,
         json_extract(value, '$.createdAt') AS created,
         json_extract(value, '$.lastUpdatedAt') AS updated,
         (SELECT COUNT(*) FROM json_each(value, '$.fullConversationHeadersOnly') h
           WHERE json_extract(h.value, '$.type') = 1) AS prompts
  FROM cursorDiskKV
  WHERE key LIKE 'composerData:%' AND json_valid(value)`;
export const readCursorSessions = (file: string, window: DateWindow): AgentSession[] => {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const hasTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cursorDiskKV'")
      .get();
    if (!hasTable) return [];
    const rows = db.prepare(QUERY).all() as Row[];
    return rows.flatMap((r): AgentSession[] => {
      if (!r.id || !r.created) return [];
      const start = new Date(r.created);
      const end = new Date(r.updated ?? r.created);
      if (end < window.start || start >= window.end) return [];
      return [
        {
          agent: "cursor",
          id: r.id,
          title: r.name || "Cursor composer session",
          start: start < window.start ? window.start : start,
          end: end >= window.end ? new Date(window.end.getTime() - 1) : end,
          prompts: r.prompts ?? 0,
        },
      ];
    });
  } finally {
    db.close();
  }
};
export const makeCursorAdapter = (
  opts: {
    readonly dbFile?: string;
  } = {},
): AgentAdapter => {
  const file = () => (opts.dbFile ? opts.dbFile : cursorDbCandidates().find(exists));
  return {
    name: "cursor",
    label: "Cursor",
    detect: Effect.sync(() => {
      const f = file();
      return f && exists(f)
        ? detected(f.replace(os.homedir(), "~"))
        : notDetected("Cursor state.vscdb not found");
    }),
    fetchSessions: (window) =>
      attempt("agent:cursor", async () => {
        const f = file();
        return f ? readCursorSessions(f, window) : [];
      }),
  };
};
