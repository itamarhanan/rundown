import { Effect } from "effect";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { type DateWindow, inWindow } from "../domain/activity";
import { attempt, detected, notDetected } from "../sources/source";
import { exists, readLines } from "../util/fs";
import { titleFromPrompts } from "../util/title";
import type { AgentAdapter, AgentSession } from "./agent";
const HISTORY = ".aider.chat.history.md";
const STARTED = /^# aider chat started at (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
export const parseAiderHistory = async (
  file: string,
  window: DateWindow,
): Promise<AgentSession[]> => {
  const mtime = (await fsp.stat(file)).mtime;
  const sessions: {
    start: Date;
    prompts: string[];
  }[] = [];
  for await (const line of readLines(file)) {
    const m = STARTED.exec(line);
    if (m) {
      const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      sessions.push({ start: new Date(y, mo - 1, d, h, mi, s), prompts: [] });
    } else if (line.startsWith("#### ") && sessions.length) {
      sessions[sessions.length - 1]!.prompts.push(line.slice(5));
    }
  }
  const cwd = path.dirname(file);
  return sessions.flatMap((s, i): AgentSession[] => {
    const end = sessions[i + 1]?.start ?? mtime;
    if (!(inWindow(s.start, window) || (s.start < window.start && end >= window.start))) return [];
    if (s.prompts.length === 0) return [];
    return [
      {
        agent: "aider",
        id: `${cwd}@${s.start.getTime()}`,
        title: titleFromPrompts(s.prompts) ?? "Aider session",
        start: s.start,
        end: end > s.start ? end : s.start,
        cwd,
        prompts: s.prompts.length,
      },
    ];
  });
};
export const makeAiderAdapter = (repos: () => readonly string[]): AgentAdapter => {
  const files = () =>
    repos()
      .map((r) => path.join(r, HISTORY))
      .filter(exists);
  return {
    name: "aider",
    label: "Aider",
    detect: Effect.sync(() => {
      const n = files().length;
      return n
        ? detected(`${n} repo${n > 1 ? "s" : ""} with ${HISTORY}`)
        : notDetected(`no ${HISTORY} in your repos`);
    }),
    fetchSessions: (window) =>
      attempt("agent:aider", async () => {
        const recent = [];
        for (const f of files()) if ((await fsp.stat(f)).mtime >= window.start) recent.push(f);
        return (await Promise.all(recent.map((f) => parseAiderHistory(f, window)))).flat();
      }),
  };
};
