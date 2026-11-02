import type { Activity } from "./activity";
import type { Brief, ProjectGroup } from "./brief";
import { summarizeCounts } from "./brief";
import { tidyTitle } from "../util/title";
import { type Calendar, formatTime } from "./window";
const PR_VERB: Partial<Record<Activity["type"], string>> = {
  "pr-merged": "Merged",
  "pr-opened": "Opened",
  "pr-reviewed": "Reviewed",
};
const ref = (a: Activity) => (typeof a.metadata.ref === "string" ? `${a.metadata.ref} ` : "");
const RANK: Partial<Record<Activity["type"], number>> = {
  "pr-merged": 0,
  "pr-opened": 1,
  issue: 2,
  "pr-reviewed": 3,
};
const projectLine = (g: ProjectGroup, maxItems: number): string[] => {
  const highlights: string[] = [];
  const ranked = [...g.activities].sort((a, b) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9));
  for (const a of ranked) {
    const verb = PR_VERB[a.type];
    if (verb) {
      const review =
        a.type === "pr-reviewed" && typeof a.metadata.review === "string"
          ? ` (${a.metadata.review})`
          : "";
      highlights.push(`${verb} ${ref(a)}${a.title}${review}`);
    } else if (a.type === "issue") {
      const action = typeof a.metadata.action === "string" ? a.metadata.action : "updated";
      highlights.push(`${action[0]!.toUpperCase()}${action.slice(1)} ${ref(a)}${a.title}`);
    }
  }
  if (highlights.length === 0) {
    for (const a of g.activities) if (a.type === "commit") highlights.push(a.title);
  }
  if (highlights.length === 0) {
    for (const a of g.activities)
      if (a.type === "agent-session") highlights.push(tidyTitle(a.title));
  }
  const shown = [...new Set(highlights)].slice(0, maxItems);
  return [`- **${g.project}**: ${summarizeCounts(g)}`, ...shown.map((h) => `  - ${h}`)];
};
const PLAN_VERB = (status: string | undefined) => {
  switch (status) {
    case "changes requested":
      return "Address review on";
    case "awaiting review":
      return "Get review on";
    case "draft":
      return "Finish";
    default:
      return "Ship";
  }
};
export const renderDigest = (brief: Brief, cal: Calendar): string => {
  const lines: string[] = [];
  const { recap, plan } = brief;
  const maxItems = brief.kind === "week" ? 5 : 3;
  if (recap) {
    lines.push(
      brief.kind === "week"
        ? `**This week** (${recap.window.label})`
        : `**Yesterday** (${recap.window.label})`,
    );
    if (recap.projects.length === 0 && recap.meetings.length === 0) lines.push("- Nothing logged.");
    for (const g of recap.projects.slice(0, brief.kind === "week" ? 10 : 6))
      lines.push(...projectLine(g, maxItems));
    const meetings = recap.meetings.filter((m) => !m.metadata.allDay);
    if (meetings.length) lines.push(`- Meetings: ${meetings.map((m) => m.title).join(", ")}`);
  }
  if (plan) {
    if (lines.length) lines.push("");
    lines.push("**Today**");
    const meetings = plan.meetings.filter((m) => !m.metadata.allDay);
    if (meetings.length) {
      lines.push(
        `- ${meetings.map((m) => `${formatTime(cal, m.timestamp)} ${m.title}`).join(" · ")}`,
      );
    }
    for (const pr of plan.authored.slice(0, 4))
      lines.push(`- ${PLAN_VERB(pr.status)} ${pr.ref} ${pr.title}`);
    if (plan.reviews.length) {
      lines.push(
        `- Review ${plan.reviews
          .slice(0, 4)
          .map((r) => r.ref)
          .join(", ")}`,
      );
    }
    for (const i of plan.issues.filter((i) => i.status?.startsWith("in progress")).slice(0, 3)) {
      lines.push(`- Continue ${i.ref} ${i.title}`);
    }
    if (lines[lines.length - 1] === "**Today**") {
      const top = recap?.projects[0];
      lines.push(top ? `- Continue on ${top.project}` : "- No meetings or open work found.");
    }
  }
  if (brief.kind !== "week") {
    lines.push("", "**Blockers**");
    lines.push(...(brief.blockers.length ? brief.blockers.map((b) => `- ${b}`) : ["- None"]));
  }
  return lines.join("\n");
};
