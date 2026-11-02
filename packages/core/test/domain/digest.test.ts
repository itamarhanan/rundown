import { describe, expect, it } from "vitest";
import type { Brief } from "../../src/domain/brief";
import { renderDigest } from "../../src/domain/digest";
import { groupByProject } from "../../src/domain/brief";
import { cal, fixtureBrief } from "../fixtures/brief";
import { act, at } from "../helpers";
describe("renderDigest", () => {
  const lines = renderDigest(fixtureBrief, cal).split("\n");
  it("has Yesterday, Today and Blockers sections in order", () => {
    const headers = lines.filter((l) => l.startsWith("**"));
    expect(headers).toEqual(["**Yesterday** (Thu, Nov 5 → today)", "**Today**", "**Blockers**"]);
  });
  it("leads each project with counts, and outcomes before commits", () => {
    const i = lines.indexOf("- **rundown**: 2 commits, 1 PR merged");
    expect(i).toBeGreaterThan(-1);
    expect(lines[i + 1]).toBe("  - Merged #42 Add daemon");
    expect(lines).not.toContain("  - feat(core): add daemon");
    expect(lines).toContain("  - Reviewed #7 Speed up indexer (approved)");
    expect(lines).toContain("  - Investigate flaky crawler");
  });
  it("lists timed meetings but not all-day ones", () => {
    expect(lines).toContain("- Meetings: Standup");
    expect(lines.join("\n")).not.toContain("Holiday");
  });
  it("plans today from meetings (local time), open PRs, reviews and in-progress issues", () => {
    expect(lines).toContain("- 10:00 Sprint planning");
    expect(lines).toContain("- Address review on #43 Web view polish");
    expect(lines).toContain("- Get review on #44 Cache eviction");
    expect(lines).toContain("- Review #9");
    expect(lines).toContain("- Continue ENG-12 Daemon install on macOS");
    expect(lines.join("\n")).not.toContain("ENG-13");
  });
  it("lists inferred blockers", () => {
    const at = lines.indexOf("**Blockers**");
    expect(lines.slice(at + 1)).toEqual([
      '- #43 "Web view polish" has changes requested',
      '- #44 "Cache eviction" waiting on review for 3 days',
    ]);
  });
  it("says so when nothing happened and nothing is planned", () => {
    const empty: Brief = {
      ...fixtureBrief,
      recap: { ...fixtureBrief.recap!, activities: [], projects: [], meetings: [], commands: [] },
      plan: { ...fixtureBrief.plan!, meetings: [], authored: [], reviews: [], issues: [] },
      blockers: [],
    };
    expect(renderDigest(empty, cal)).toBe(
      [
        "**Yesterday** (Thu, Nov 5 → today)",
        "- Nothing logged.",
        "",
        "**Today**",
        "- No meetings or open work found.",
        "",
        "**Blockers**",
        "- None",
      ].join("\n"),
    );
  });
  it("week digests have no blockers section", () => {
    const week: Brief = { ...fixtureBrief, kind: "week", plan: undefined } as Brief;
    const text = renderDigest(week, cal);
    expect(text.startsWith("**This week**")).toBe(true);
    expect(text).not.toContain("**Blockers**");
  });
  it("shows agent sessions by a clean title, even ones cached as raw prompts", () => {
    const raw = act({
      type: "agent-session",
      timestamp: at("2026-11-05T13:00:00Z"),
      project: "scout",
      title:
        "<system-reminder>be nice</system-reminder>\nHTTP 403 fetching https://www.sqlink.com/career/bidbabig-data/data-engineer/data-engineer-3/?utm=x — why?\n\n[Pasted text #1 +40 lines]",
      metadata: { agent: "opencode", prompts: 2 },
    });
    const activities = [raw];
    const brief: Brief = {
      ...fixtureBrief,
      recap: {
        ...fixtureBrief.recap!,
        activities,
        projects: groupByProject(activities),
        meetings: [],
        commands: [],
      },
    };
    expect(renderDigest(brief, cal).split("\n")).toContain(
      "  - HTTP 403 fetching sqlink.com/…/data-engineer/data-engineer-3 — why?",
    );
  });
});
