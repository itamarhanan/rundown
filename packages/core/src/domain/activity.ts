export type ActivitySource = "git" | "github-pr" | "linear" | "calendar" | "agent" | "shell";
export type ActivityType =
  | "commit"
  | "pr-opened"
  | "pr-merged"
  | "pr-reviewed"
  | "issue"
  | "meeting"
  | "agent-session"
  | "command";
export interface Activity {
  readonly id: string;
  readonly source: ActivitySource;
  readonly type: ActivityType;
  readonly timestamp: Date;
  readonly end?: Date;
  readonly title: string;
  readonly description?: string;
  readonly project?: string;
  readonly url?: string;
  readonly metadata: Record<string, unknown>;
}
export type OpenItemKind = "pr-authored" | "review-requested" | "issue-assigned";

export interface OpenItem {
  readonly id: string;
  readonly source: "github" | "linear";
  readonly kind: OpenItemKind;
  readonly title: string;
  readonly ref: string;
  readonly url: string;
  readonly project?: string;
  readonly updatedAt: Date;
  readonly createdAt?: Date;
  readonly status?: string;
}
export interface DateWindow {
  readonly start: Date;
  readonly end: Date;
}
export const inWindow = (date: Date, window: DateWindow): boolean =>
  date.getTime() >= window.start.getTime() && date.getTime() < window.end.getTime();
export const overlapsWindow = (start: Date, end: Date, window: DateWindow): boolean =>
  start.getTime() < window.end.getTime() && end.getTime() >= window.start.getTime();
