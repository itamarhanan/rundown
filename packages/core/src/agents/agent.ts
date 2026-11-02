import type { Effect } from "effect";
import type { Activity, DateWindow } from "../domain/activity";
import type { SourceError } from "../errors";
import type { Detection } from "../sources/source";
import { projectFromPath } from "../util/project";
export interface AgentSession {
  readonly agent: string;
  readonly id: string;
  readonly title: string;
  readonly prompt?: string;
  readonly start: Date;
  readonly end: Date;
  readonly cwd?: string;
  readonly prompts: number;
  readonly model?: string;
  readonly branch?: string;
  readonly files?: number;
  readonly additions?: number;
  readonly deletions?: number;
  readonly prs?: readonly string[];
}
export type AgentFetchError = SourceError;
export interface AgentAdapter {
  readonly name: string;
  readonly label: string;
  readonly detect: Effect.Effect<Detection>;
  readonly fetchSessions: (
    window: DateWindow,
  ) => Effect.Effect<readonly AgentSession[], AgentFetchError>;
}
export const sessionToActivity = (s: AgentSession): Activity => {
  const stats = s.files ? `${s.files} files, +${s.additions ?? 0}/-${s.deletions ?? 0}` : undefined;
  const prompts = `${s.prompts} prompt${s.prompts === 1 ? "" : "s"}`;
  const project = projectFromPath(s.cwd);
  return {
    id: `agent:${s.agent}:${s.id}`,
    source: "agent",
    type: "agent-session",
    timestamp: s.start,
    end: s.end,
    title: s.title,
    description: [prompts, stats].filter(Boolean).join(" · "),
    ...(project ? { project } : {}),
    metadata: {
      agent: s.agent,
      prompts: s.prompts,
      ...(s.cwd ? { cwd: s.cwd } : {}),
      ...(s.model ? { model: s.model } : {}),
      ...(s.branch ? { branch: s.branch } : {}),
      ...(s.files
        ? { files: s.files, additions: s.additions ?? 0, deletions: s.deletions ?? 0 }
        : {}),
      ...(s.prs?.length ? { prs: s.prs } : {}),
      ...(s.prompt ? { prompt: s.prompt } : {}),
    },
  };
};
export const isNoisePrompt = (text: string): boolean => {
  const t = text.trimStart();
  return (
    t.length === 0 ||
    t.startsWith("<") ||
    t.startsWith("# AGENTS.md") ||
    t.startsWith("Caveat:") ||
    t.startsWith("[Request interrupted")
  );
};
