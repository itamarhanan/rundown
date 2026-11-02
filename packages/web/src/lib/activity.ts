import {
  BotIcon,
  CalendarDaysIcon,
  CircleDotIcon,
  EyeIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestArrowIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import type { Activity, ActivityType } from "../types";
export const ACTIVITY_ICON: Record<ActivityType, LucideIcon> = {
  commit: GitCommitHorizontalIcon,
  "pr-opened": GitPullRequestArrowIcon,
  "pr-merged": GitMergeIcon,
  "pr-reviewed": EyeIcon,
  issue: CircleDotIcon,
  meeting: CalendarDaysIcon,
  "agent-session": BotIcon,
  command: TerminalIcon,
};
export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  commit: "Commit",
  "pr-opened": "Opened PR",
  "pr-merged": "Merged PR",
  "pr-reviewed": "Reviewed PR",
  issue: "Issue",
  meeting: "Meeting",
  "agent-session": "Agent session",
  command: "Command",
};
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const meta = (a: Activity) => ({
  ref: str(a.metadata.ref),
  review: str(a.metadata.review),
  agent: str(a.metadata.agent),
  prompts: num(a.metadata.prompts),
  additions: num(a.metadata.additions),
  deletions: num(a.metadata.deletions),
  branch: str(a.metadata.branch),
  allDay: a.metadata.allDay === true,
  prs: Array.isArray(a.metadata.prs)
    ? a.metadata.prs.filter((p): p is string => typeof p === "string")
    : [],
});
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
export const prLabel = (url: string) => {
  const m = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(url);
  return m ? `${m[1]}#${m[2]}` : url.replace(/^https?:\/\//, "");
};
export type Urgency = "danger" | "warning" | "success" | "neutral";
export const statusUrgency = (status: string | undefined): Urgency => {
  if (!status) return "neutral";
  if (status === "changes requested" || status.startsWith("blocked")) return "danger";
  if (status === "approved" || status === "done") return "success";
  return "neutral";
};
export const shortRef = (ref: string) => ref.replace(/^[^#\s]+(?=#\d)/, "");
