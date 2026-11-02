import Database from "better-sqlite3";
import { Effect } from "effect";
import * as os from "node:os";
import * as path from "node:path";
import type { DateWindow } from "../domain/activity";
import { SourceError } from "../errors";
import { attempt, detected, notDetected } from "../sources/source";
import { exists, tryJson } from "../util/fs";
import { cleanName, isTrivialPrompt, keepPrompt, titleFromPrompts } from "../util/title";
import { type AgentAdapter, type AgentSession, isNoisePrompt } from "./agent";
const dbPath = (base?: string) =>
  path.join(
    base ?? process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "opencode",
    "opencode.db",
  );
interface Row {
  id: string;
  title: string | null;
  directory: string;
  model: string | null;
  summary_files: number | null;
  summary_additions: number | null;
  summary_deletions: number | null;
  first_at: number | null;
  last_at: number | null;
  prompts: number;
  first_prompts: string | null;
}
const QUERY = `
  SELECT s.id, s.title, s.directory, s.model,
         s.summary_files, s.summary_additions, s.summary_deletions,
         w.first_at, w.last_at, w.prompts,
         (SELECT json_group_array(data) FROM (
            SELECT m.data FROM session_message m
             WHERE m.session_id = s.id AND m.type = 'user' ORDER BY m.seq LIMIT 5)) AS first_prompts
  FROM session_v2 s
  JOIN (
    SELECT session_id,
           MIN(time_created) AS first_at,
           MAX(time_created) AS last_at,
           SUM(type = 'user') AS prompts
    FROM session_message
    WHERE time_created >= @start AND time_created < @end
    GROUP BY session_id
  ) w ON w.session_id = s.id
  WHERE s.parent_id IS NULL
    -- Headless SDK/server sessions (an app using OpenCode as an LLM backend)
    -- never get an agent, a model, or a view. They aren't your work.
    AND NOT (s.agent IS NULL AND s.model IS NULL AND s.time_viewed IS NULL)`;
const modelName = (raw: string | null) => {
  const m = raw
    ? tryJson<{
        id?: string;
        providerID?: string;
      }>(raw)
    : undefined;
  return m?.id ? (m.providerID ? `${m.providerID}/${m.id}` : m.id) : undefined;
};
export const readOpenCodeSessions = (file: string, window: DateWindow): AgentSession[] => {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const hasV2 = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_v2'")
      .get();
    if (!hasV2) {
      throw new SourceError({
        source: "agent:opencode",
        message: "unsupported opencode.db schema (no session_v2 table)",
        hint: "update OpenCode, or disable with sources.agents.opencode: false",
      });
    }
    const rows = db
      .prepare(QUERY)
      .all({ start: window.start.getTime(), end: window.end.getTime() }) as Row[];
    return rows.map((r): AgentSession => {
      const early = (tryJson<string[]>(r.first_prompts ?? "[]") ?? [])
        .map(
          (d) =>
            tryJson<{
              text?: string;
            }>(d)?.text ?? "",
        )
        .filter((t) => !isNoisePrompt(t));
      const prompt = early.find((p) => !isTrivialPrompt(p)) ?? early[0];
      const model = modelName(r.model);
      const own =
        r.title && !/^(New|Child) session - \d{4}-/.test(r.title) ? cleanName(r.title) : "";
      return {
        agent: "opencode",
        id: r.id,
        title: own || titleFromPrompts(early) || "OpenCode session",
        ...(prompt ? { prompt: keepPrompt(prompt) } : {}),
        start: new Date(r.first_at!),
        end: new Date(r.last_at!),
        cwd: r.directory,
        prompts: r.prompts,
        ...(model ? { model } : {}),
        ...(r.summary_files
          ? {
              files: r.summary_files,
              additions: r.summary_additions ?? 0,
              deletions: r.summary_deletions ?? 0,
            }
          : {}),
      };
    });
  } finally {
    db.close();
  }
};
export const makeOpenCodeAdapter = (
  opts: {
    readonly dataDir?: string;
  } = {},
): AgentAdapter => {
  const file = dbPath(opts.dataDir);
  return {
    name: "opencode",
    label: "OpenCode",
    detect: Effect.sync(() =>
      exists(file)
        ? detected(file.replace(os.homedir(), "~"))
        : notDetected("opencode.db not found"),
    ),
    fetchSessions: (window) =>
      attempt("agent:opencode", async () => readOpenCodeSessions(file, window)),
  };
};
