import { describe, expect, it } from "vitest";
import { groupByProject, inferBlockers, type Plan, summarizeCounts } from "../../src/domain/brief";
import { dayWindow, makeCalendar } from "../../src/domain/window";
import { act, at, openItem } from "../helpers";
describe("groupByProject", () => {
  const activities = [
    ...Array.from({ length: 9 }, (_, i) =>
      act({
        type: "agent-session",
        timestamp: at(`2026-11-05T0${i % 10}:00:00Z`),
        project: "chatty",
        metadata: { prompts: 3 },
      }),
    ),
    act({ type: "pr-merged", timestamp: at("2026-11-05T10:00:00Z"), project: "Rundown" }),
    act({
      type: "commit",
      timestamp: at("2026-11-05T09:00:00Z"),
      project: "rundown",
      metadata: { additions: 10, deletions: 2 },
    }),
    act({
      type: "commit",
      timestamp: at("2026-11-05T11:00:00Z"),
      project: "rundown",
      metadata: { additions: 5, deletions: "x" },
    }),
    act({ type: "commit", timestamp: at("2026-11-05T18:00:00Z"), project: "late" }),
    act({ type: "commit", timestamp: at("2026-11-05T08:00:00Z"), project: "late" }),
    act({ type: "pr-opened", timestamp: at("2026-11-05T12:00:00Z"), project: "solo" }),
    act({ type: "issue", timestamp: at("2026-11-05T07:00:00Z") }),
    act({ type: "meeting", timestamp: at("2026-11-05T07:00:00Z"), project: "rundown" }),
    act({ type: "command", timestamp: at("2026-11-05T07:00:00Z"), project: "rundown" }),
  ];
  const groups = groupByProject(activities);
  it("ranks shipped work above chatter, then by recency", () => {
    expect(groups.map((g) => g.project)).toEqual(["Rundown", "chatty", "late", "solo", "Other"]);
  });
  it("merges projects case-insensitively and keeps the first spelling", () => {
    const r = groups.find((g) => g.project === "Rundown")!;
    expect(r.activities).toHaveLength(3);
    expect(r.commits).toBe(2);
    expect(r.prsMerged).toBe(1);
  });
  it("sums line stats, ignoring non-numeric metadata", () => {
    const r = groups.find((g) => g.project === "Rundown")!;
    expect([r.additions, r.deletions]).toEqual([15, 2]);
  });
  it("counts agent prompts and sorts each group's activities by time", () => {
    const c = groups.find((g) => g.project === "chatty")!;
    expect([c.sessions, c.prompts]).toEqual([9, 27]);
    const late = groups.find((g) => g.project === "late")!;
    expect(late.activities.map((a) => a.timestamp.getUTCHours())).toEqual([8, 18]);
    expect(late.lastAt.toISOString()).toBe("2026-11-05T18:00:00.000Z");
  });
  it("leaves meetings and shell commands out of project groups", () => {
    expect(
      groups.flatMap((g) => g.activities).some((a) => a.type === "meeting" || a.type === "command"),
    ).toBe(false);
  });
  it("returns nothing for nothing", () => {
    expect(groupByProject([])).toEqual([]);
  });
});
describe("inferBlockers", () => {
  const cal = makeCalendar("UTC", [1, 2, 3, 4, 5]);
  const now = at("2026-11-10T09:00:00Z");
  const plan = (authored: Plan["authored"]): Plan => ({
    window: dayWindow(cal, now),
    meetings: [],
    sofar: [],
    reviews: [],
    issues: [],
    authored,
  });
  it("flags changes requested regardless of age", () => {
    const pr = openItem({
      kind: "pr-authored",
      ref: "#1",
      title: "Fix auth",
      status: "changes requested",
      createdAt: now,
    });
    expect(inferBlockers(plan([pr]), now)).toEqual(['#1 "Fix auth" has changes requested']);
  });
  it("flags PRs awaiting review for two days or more", () => {
    const old = openItem({
      kind: "pr-authored",
      ref: "#2",
      title: "Old",
      status: "awaiting review",
      createdAt: at("2026-11-07T09:00:00Z"),
    });
    const edge = openItem({
      kind: "pr-authored",
      ref: "#3",
      title: "Edge",
      status: "awaiting review",
      createdAt: at("2026-11-08T09:00:00Z"),
    });
    const fresh = openItem({
      kind: "pr-authored",
      ref: "#4",
      title: "Fresh",
      status: "awaiting review",
      createdAt: at("2026-11-08T09:00:01Z"),
    });
    expect(inferBlockers(plan([old, edge, fresh]), now)).toEqual([
      '#2 "Old" waiting on review for 3 days',
      '#3 "Edge" waiting on review for 2 days',
    ]);
  });
  it("falls back to updatedAt when createdAt is missing, and ignores drafts and approved PRs", () => {
    const noCreated = openItem({
      kind: "pr-authored",
      ref: "#5",
      title: "Stale",
      status: "awaiting review",
      updatedAt: at("2026-11-01T00:00:00Z"),
    });
    const draft = openItem({
      kind: "pr-authored",
      ref: "#6",
      status: "draft",
      createdAt: at("2026-10-01T00:00:00Z"),
    });
    const approved = openItem({
      kind: "pr-authored",
      ref: "#7",
      status: "approved",
      createdAt: at("2026-10-01T00:00:00Z"),
    });
    expect(inferBlockers(plan([noCreated, draft, approved]), now)).toEqual([
      '#5 "Stale" waiting on review for 9 days',
    ]);
  });
  it("has nothing to say without a plan", () => {
    expect(inferBlockers(undefined, now)).toEqual([]);
  });
});
describe("summarizeCounts", () => {
  it("pluralizes, skips zeros, and keeps a fixed order", () => {
    const [g] = groupByProject([
      act({ type: "commit", timestamp: at("2026-11-05T09:00:00Z"), project: "p" }),
      act({ type: "commit", timestamp: at("2026-11-05T09:00:00Z"), project: "p" }),
      act({ type: "pr-merged", timestamp: at("2026-11-05T09:00:00Z"), project: "p" }),
      act({ type: "pr-reviewed", timestamp: at("2026-11-05T09:00:00Z"), project: "p" }),
      act({ type: "pr-reviewed", timestamp: at("2026-11-05T09:00:00Z"), project: "p" }),
      act({ type: "agent-session", timestamp: at("2026-11-05T09:00:00Z"), project: "p" }),
    ]);
    expect(summarizeCounts(g!)).toBe("2 commits, 1 PR merged, 2 reviews, 1 agent session");
  });
  it("counts issues on their own", () => {
    const [g] = groupByProject([
      act({ type: "issue", timestamp: at("2026-11-05T09:00:00Z"), project: "p" }),
    ]);
    expect(summarizeCounts(g!)).toBe("1 issue");
  });
});
