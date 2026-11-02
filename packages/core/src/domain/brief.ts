import type { SourceReport } from "../sources/source";
import { projectKey } from "../util/project";
import type { Activity, OpenItem } from "./activity";
import type { LabeledWindow } from "./window";
export type BriefKind = "yesterday" | "today" | "morning" | "week";
export const BriefKinds: readonly BriefKind[] = ["morning", "yesterday", "today", "week"];
export interface ProjectGroup {
  readonly project: string;
  readonly activities: readonly Activity[];
  readonly commits: number;
  readonly additions: number;
  readonly deletions: number;
  readonly prsOpened: number;
  readonly prsMerged: number;
  readonly prsReviewed: number;
  readonly issues: number;
  readonly sessions: number;
  readonly prompts: number;
  readonly lastAt: Date;
}
export interface DayCount {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}
export interface Recap {
  readonly window: LabeledWindow;
  readonly activities: readonly Activity[];
  readonly projects: readonly ProjectGroup[];
  readonly meetings: readonly Activity[];
  readonly commands: readonly Activity[];
  readonly days?: readonly DayCount[];
}
export interface Plan {
  readonly window: LabeledWindow;
  readonly meetings: readonly Activity[];
  readonly authored: readonly OpenItem[];
  readonly reviews: readonly OpenItem[];
  readonly issues: readonly OpenItem[];
  readonly sofar: readonly Activity[];
}
export type SummaryOrigin = "llm" | "digest" | "edited";
export interface Summary {
  readonly text: string;
  readonly origin: SummaryOrigin;
  readonly model?: string;
  readonly cached: boolean;
  readonly note?: string;
}
export interface Brief {
  readonly kind: BriefKind;
  readonly key: string;
  readonly generatedAt: Date;
  readonly user: {
    readonly name: string;
    readonly timeZone: string;
  };
  readonly recap?: Recap;
  readonly plan?: Plan;
  readonly blockers: readonly string[];
  readonly summary: Summary;
  readonly reports: readonly SourceReport[];
}
const num = (v: unknown) => (typeof v === "number" ? v : 0);
export const groupByProject = (activities: readonly Activity[]): ProjectGroup[] => {
  const groups = new Map<
    string,
    {
      project: string;
      items: Activity[];
    }
  >();
  for (const a of activities) {
    if (a.type === "meeting" || a.type === "command") continue;
    const key = projectKey(a.project) || "(other)";
    const g = groups.get(key) ?? { project: a.project ?? "Other", items: [] };
    g.items.push(a);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ project, items }): ProjectGroup => {
      const sorted = [...items].sort((x, y) => x.timestamp.getTime() - y.timestamp.getTime());
      const of = (t: Activity["type"]) => items.filter((a) => a.type === t);
      const commits = of("commit");
      const sessions = of("agent-session");
      return {
        project,
        activities: sorted,
        commits: commits.length,
        additions: commits.reduce((n, c) => n + num(c.metadata.additions), 0),
        deletions: commits.reduce((n, c) => n + num(c.metadata.deletions), 0),
        prsOpened: of("pr-opened").length,
        prsMerged: of("pr-merged").length,
        prsReviewed: of("pr-reviewed").length,
        issues: of("issue").length,
        sessions: sessions.length,
        prompts: sessions.reduce((n, s) => n + num(s.metadata.prompts), 0),
        lastAt: sorted[sorted.length - 1]!.timestamp,
      };
    })
    .sort((a, b) => weight(b) - weight(a) || b.lastAt.getTime() - a.lastAt.getTime());
};
const weight = (g: ProjectGroup) =>
  g.prsMerged * 6 + g.prsOpened * 4 + g.prsReviewed * 3 + g.commits * 2 + g.issues * 2 + g.sessions;
const DAY = 86400000;
export const inferBlockers = (plan: Plan | undefined, now: Date): string[] => {
  if (!plan) return [];
  const out: string[] = [];
  for (const pr of plan.authored) {
    const age = Math.floor((now.getTime() - (pr.createdAt ?? pr.updatedAt).getTime()) / DAY);
    if (pr.status === "changes requested")
      out.push(`${pr.ref} "${pr.title}" has changes requested`);
    else if (pr.status === "awaiting review" && age >= 2) {
      out.push(`${pr.ref} "${pr.title}" waiting on review for ${age} days`);
    }
  }
  return out;
};
export const summarizeCounts = (g: ProjectGroup): string => {
  const parts: string[] = [];
  const n = (count: number, one: string, many = `${one}s`) =>
    count && parts.push(`${count} ${count === 1 ? one : many}`);
  n(g.commits, "commit");
  n(g.prsMerged, "PR merged", "PRs merged");
  n(g.prsOpened, "PR opened", "PRs opened");
  n(g.prsReviewed, "review");
  n(g.issues, "issue");
  n(g.sessions, "agent session");
  return parts.join(", ");
};
