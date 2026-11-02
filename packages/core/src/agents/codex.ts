import { Effect } from "effect";
import * as os from "node:os";
import * as path from "node:path";
import { type DateWindow, inWindow } from "../domain/activity";
import { attempt, detected, notDetected } from "../sources/source";
import { exists, filesModifiedSince, readLines, tryJson } from "../util/fs";
import { cleanName, isTrivialPrompt, keepPrompt, titleFromPrompts } from "../util/title";
import { type AgentAdapter, type AgentSession, isNoisePrompt } from "./agent";
const codexHome = (base?: string) =>
  base ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
const TS = /^\{"timestamp":"([^"]+)"/;
interface RolloutLine {
  type: string;
  payload?: {
    type?: string;
    role?: string;
    id?: string;
    cwd?: string;
    model?: string;
    git?: {
      branch?: string;
    };
    content?: readonly {
      type: string;
      text?: string;
    }[];
  };
}
const readThreadNames = async (home: string): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  const file = path.join(home, "session_index.jsonl");
  if (!exists(file)) return names;
  for await (const line of readLines(file)) {
    const j = tryJson<{
      id?: string;
      thread_name?: string;
    }>(line);
    if (j?.id && j.thread_name) names.set(j.id, j.thread_name);
  }
  return names;
};
export const parseCodexRollout = async (
  file: string,
  window: DateWindow,
  names: ReadonlyMap<string, string> = new Map(),
): Promise<AgentSession | undefined> => {
  let first: Date | undefined;
  let last: Date | undefined;
  let id: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let branch: string | undefined;
  const early: string[] = [];
  let prompts = 0;
  for await (const line of readLines(file)) {
    const tsRaw = TS.exec(line)?.[1];
    const at = tsRaw ? new Date(tsRaw) : undefined;
    const inside = at !== undefined && inWindow(at, window);
    const relevant =
      line.includes('"type":"session_meta"') ||
      line.includes('"type":"turn_context"') ||
      line.includes('"role":"user"');
    if (inside && !line.includes('"type":"session_meta"')) {
      if (!first || at! < first) first = at;
      if (!last || at! > last) last = at;
    }
    if (!relevant) continue;
    const j = tryJson<RolloutLine>(line);
    const p = j?.payload;
    if (!j || !p) continue;
    if (j.type === "session_meta") {
      id = p.id ?? id;
      cwd = p.cwd ?? cwd;
      branch = p.git?.branch ?? branch;
    } else if (j.type === "turn_context") {
      model ??= p.model;
      cwd ??= p.cwd;
    } else if (j.type === "response_item" && p.type === "message" && p.role === "user") {
      const text = (p.content ?? []).map((c) => c.text ?? "").join("\n");
      if (isNoisePrompt(text)) continue;
      if (early.length < 5) early.push(text);
      if (inside) prompts++;
    }
  }
  if (!first || !last) return undefined;
  const sessionId = id ?? path.basename(file, ".jsonl");
  const name = names.get(sessionId);
  const title = (name && cleanName(name)) || titleFromPrompts(early) || "Codex session";
  const prompt = early.find((p) => !isTrivialPrompt(p)) ?? early[0];
  return {
    agent: "codex",
    id: sessionId,
    title,
    ...(prompt ? { prompt: keepPrompt(prompt) } : {}),
    start: first,
    end: last,
    prompts,
    ...(cwd ? { cwd } : {}),
    ...(model ? { model } : {}),
    ...(branch ? { branch } : {}),
  };
};
export const makeCodexAdapter = (
  opts: {
    readonly baseDir?: string;
  } = {},
): AgentAdapter => {
  const home = codexHome(opts.baseDir);
  const sessions = path.join(home, "sessions");
  return {
    name: "codex",
    label: "Codex CLI",
    detect: Effect.sync(() =>
      exists(sessions)
        ? detected(sessions.replace(os.homedir(), "~"))
        : notDetected("~/.codex/sessions not found"),
    ),
    fetchSessions: (window) =>
      attempt("agent:codex", async () => {
        const [files, names] = await Promise.all([
          filesModifiedSince(
            sessions,
            window.start,
            (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"),
            {
              maxDepth: 4,
            },
          ),
          readThreadNames(home),
        ]);
        const parsed = await Promise.all(
          files.map((f) => parseCodexRollout(f.path, window, names)),
        );
        return parsed.filter((s): s is AgentSession => s !== undefined);
      }),
  };
};
