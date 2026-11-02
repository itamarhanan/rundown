import { Effect } from "effect";
import * as os from "node:os";
import * as path from "node:path";
import { type DateWindow, inWindow } from "../domain/activity";
import { attempt, detected, notDetected } from "../sources/source";
import { exists, filesModifiedSince, readLines, tryJson } from "../util/fs";
import { cleanName, isTrivialPrompt, keepPrompt, titleFromPrompts } from "../util/title";
import { type AgentAdapter, type AgentSession, isNoisePrompt } from "./agent";
const projectsDir = (base?: string) =>
  path.join(
    base ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
    "projects",
  );
const TS = /"timestamp":"([^"]+)"/;
const MODEL = /"model":"([^"]+)"/;
const MAX_PARSE = 64 * 1024;
interface UserLine {
  isSidechain?: boolean;
  isMeta?: boolean;
  cwd?: string;
  gitBranch?: string;
  message?: {
    content?:
      | string
      | readonly {
          type: string;
          text?: string;
        }[];
  };
}
const promptText = (line: UserLine): string | undefined => {
  const c = line.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c.every((p) => p.type === "text"))
    return c.map((p) => p.text ?? "").join("\n");
  return undefined;
};
export const parseClaudeSession = async (
  file: string,
  window: DateWindow,
): Promise<AgentSession | undefined> => {
  let first: Date | undefined;
  let last: Date | undefined;
  let prompts = 0;
  const early: string[] = [];
  let aiTitle: string | undefined;
  let customTitle: string | undefined;
  let cwd: string | undefined;
  let branch: string | undefined;
  let model: string | undefined;
  const prs = new Set<string>();
  for await (const line of readLines(file)) {
    const isUser = line.includes('"type":"user"');
    const isAssistant = !isUser && line.includes('"type":"assistant"');
    if (isUser || isAssistant) {
      if (line.includes('"isSidechain":true')) continue;
      const tsRaw = TS.exec(line)?.[1];
      const at = tsRaw ? new Date(tsRaw) : undefined;
      const inside = at !== undefined && inWindow(at, window);
      if (inside) {
        if (!first || at! < first) first = at;
        if (!last || at! > last) last = at;
      }
      if (isAssistant) {
        if (inside && !model) model = MODEL.exec(line)?.[1];
        continue;
      }
      if (line.length > MAX_PARSE) continue;
      const u = tryJson<UserLine>(line);
      if (!u || u.isMeta) continue;
      cwd ??= u.cwd;
      if (u.gitBranch && u.gitBranch !== "HEAD") branch ??= u.gitBranch;
      const text = promptText(u);
      if (text && !isNoisePrompt(text)) {
        if (early.length < 5) early.push(text);
        if (inside) prompts++;
      }
    } else if (line.includes('"type":"ai-title"')) {
      aiTitle =
        tryJson<{
          aiTitle?: string;
        }>(line)?.aiTitle ?? aiTitle;
    } else if (line.includes('"type":"custom-title"')) {
      const j = tryJson<{
        customTitle?: string;
        title?: string;
      }>(line);
      customTitle = j?.customTitle ?? j?.title ?? customTitle;
    } else if (line.includes('"type":"summary"') && !aiTitle) {
      aiTitle = tryJson<{
        summary?: string;
      }>(line)?.summary;
    } else if (line.includes('"type":"pr-link"')) {
      const j = tryJson<{
        prUrl?: string;
        timestamp?: string;
      }>(line);
      if (j?.prUrl && j.timestamp && inWindow(new Date(j.timestamp), window)) prs.add(j.prUrl);
    }
  }
  if (!first || !last) return undefined;
  const title =
    (customTitle && cleanName(customTitle)) ||
    (aiTitle && cleanName(aiTitle)) ||
    titleFromPrompts(early);
  const prompt = early.find((p) => !isTrivialPrompt(p)) ?? early[0];
  return {
    agent: "claude",
    id: path.basename(file, ".jsonl"),
    title: title || `Claude Code session in ${path.basename(cwd ?? "project")}`,
    ...(prompt ? { prompt: keepPrompt(prompt) } : {}),
    start: first,
    end: last,
    prompts,
    ...(cwd ? { cwd } : {}),
    ...(branch ? { branch } : {}),
    ...(model ? { model } : {}),
    ...(prs.size ? { prs: [...prs] } : {}),
  };
};
export const makeClaudeAdapter = (
  opts: {
    readonly baseDir?: string;
  } = {},
): AgentAdapter => {
  const dir = projectsDir(opts.baseDir);
  return {
    name: "claude",
    label: "Claude Code",
    detect: Effect.sync(() =>
      exists(dir)
        ? detected(dir.replace(os.homedir(), "~"))
        : notDetected("~/.claude/projects not found"),
    ),
    fetchSessions: (window) =>
      attempt("agent:claude", async () => {
        const files = await filesModifiedSince(dir, window.start, (n) => n.endsWith(".jsonl"), {
          maxDepth: 1,
        });
        const sessions = await Promise.all(files.map((f) => parseClaudeSession(f.path, window)));
        return sessions.filter((s): s is AgentSession => s !== undefined);
      }),
  };
};
