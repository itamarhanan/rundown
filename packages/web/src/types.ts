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
  readonly timestamp: string;
  readonly end?: string;
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
  readonly updatedAt: string;
  readonly createdAt?: string;
  readonly status?: string;
}
export interface LabeledWindow {
  readonly start: string;
  readonly end: string;
  readonly label: string;
  readonly key: string;
}
export type BriefKind = "morning" | "yesterday" | "today" | "week";
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
  readonly lastAt: string;
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
export type SourceStatus = "ok" | "skipped" | "failed";
export interface SourceReport {
  readonly id: string;
  readonly label: string;
  readonly status: SourceStatus;
  readonly detail: string;
  readonly count: number;
  readonly durationMs: number;
  readonly hint?: string;
}
export interface Detection {
  readonly available: boolean;
  readonly detail: string;
}
export interface Brief {
  readonly kind: BriefKind;
  readonly key: string;
  readonly generatedAt: string;
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
export type Delivery = "notification" | "terminal" | "web" | "file";
export interface Meta {
  readonly version: string;
  readonly user: {
    readonly name: string;
    readonly timeZone: string;
    readonly workdays: readonly number[];
  };
  readonly llm:
    | {
        readonly ok: true;
        readonly model: string;
      }
    | {
        readonly ok: false;
        readonly reason: string;
      };
  readonly schedule: {
    readonly morningBrief: string;
    readonly delivery: Delivery;
    readonly port: number;
  };
  readonly paths: {
    readonly config: string;
    readonly data: string;
  };
}
export interface SourceInfo {
  readonly id: string;
  readonly label: string;
  readonly detection: Detection;
}
export interface SourcesResponse {
  readonly sources: readonly SourceInfo[];
  readonly last: {
    readonly at: string;
    readonly reports: readonly SourceReport[];
  } | null;
}
export interface SourcesTest {
  readonly reports: readonly SourceReport[];
  readonly activities: number;
  readonly open: number;
}
export interface HistoryDay {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly meetings: number;
  readonly projects: readonly {
    readonly project: string;
    readonly count: number;
  }[];
}
