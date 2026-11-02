import type { Brief } from "../../src/domain/brief";
import { groupByProject, inferBlockers } from "../../src/domain/brief";
import { dayWindow, makeCalendar, sinceLastWorkday } from "../../src/domain/window";
import { act, at, openItem } from "../helpers";
export const cal = makeCalendar("Asia/Jerusalem", [0, 1, 2, 3, 4]);
export const now = at("2026-11-08T07:00:00Z");
const recapActs = [
  act({
    type: "commit",
    timestamp: at("2026-11-05T08:00:00Z"),
    project: "rundown",
    title: "feat(core): add daemon",
    metadata: { additions: 120, deletions: 4, branch: "feat/daemon" },
  }),
  act({
    type: "commit",
    timestamp: at("2026-11-05T09:00:00Z"),
    project: "rundown",
    title: "test(core): window math",
    metadata: { additions: 80, deletions: 0 },
  }),
  act({
    type: "pr-merged",
    timestamp: at("2026-11-06T10:00:00Z"),
    project: "rundown",
    title: "Add daemon",
    metadata: { ref: "#42" },
  }),
  act({
    type: "pr-reviewed",
    timestamp: at("2026-11-05T12:00:00Z"),
    project: "nautilus",
    title: "Speed up indexer",
    metadata: { ref: "#7", review: "approved" },
  }),
  act({
    type: "agent-session",
    timestamp: at("2026-11-05T13:00:00Z"),
    project: "scout",
    title: "Investigate flaky crawler",
    metadata: { agent: "claude", prompts: 4 },
  }),
  act({ type: "meeting", timestamp: at("2026-11-05T07:30:00Z"), title: "Standup", metadata: {} }),
  act({
    type: "meeting",
    timestamp: at("2026-11-05T00:00:00Z"),
    title: "Holiday",
    metadata: { allDay: true },
  }),
  act({
    type: "command",
    timestamp: at("2026-11-05T14:00:00Z"),
    title: "git push origin main",
    metadata: { command: "git push origin main" },
  }),
];
const authored = [
  openItem({
    kind: "pr-authored",
    ref: "#43",
    title: "Web view polish",
    status: "changes requested",
    createdAt: at("2026-11-07T10:00:00Z"),
  }),
  openItem({
    kind: "pr-authored",
    ref: "#44",
    title: "Cache eviction",
    status: "awaiting review",
    createdAt: at("2026-11-04T10:00:00Z"),
  }),
];
const recapWindow = sinceLastWorkday(cal, now);
const planWindow = dayWindow(cal, now);
const plan = {
  window: planWindow,
  meetings: [
    act({
      type: "meeting",
      timestamp: at("2026-11-08T08:00:00Z"),
      title: "Sprint planning",
      metadata: {},
    }),
  ],
  sofar: [],
  authored,
  reviews: [openItem({ kind: "review-requested", ref: "#9", title: "Refactor" })],
  issues: [
    openItem({
      kind: "issue-assigned",
      ref: "ENG-12",
      title: "Daemon install on macOS",
      status: "in progress",
      source: "linear",
    }),
    openItem({
      kind: "issue-assigned",
      ref: "ENG-13",
      title: "Backlog thing",
      status: "todo",
      source: "linear",
    }),
  ],
};
export const fixtureBrief: Brief = {
  kind: "morning",
  key: `morning:${planWindow.key}`,
  generatedAt: now,
  user: { name: "Itamar", timeZone: "Asia/Jerusalem" },
  recap: {
    window: recapWindow,
    activities: recapActs,
    projects: groupByProject(recapActs),
    meetings: recapActs.filter((a) => a.type === "meeting"),
    commands: recapActs.filter((a) => a.type === "command"),
  },
  plan,
  blockers: inferBlockers(plan, now),
  summary: { text: "", origin: "digest", cached: false },
  reports: [],
};
