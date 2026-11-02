import { describe, expect, it } from "vitest";
import type { Brief } from "../../src/domain/brief";
import { buildPrompt } from "../../src/domain/prompt";
import { cal, fixtureBrief } from "../fixtures/brief";
describe("buildPrompt", () => {
  const { system, prompt } = buildPrompt(fixtureBrief, cal, {
    maxWords: 120,
    instructions: "Write in Hebrew.",
  });
  const lines = prompt.split("\n");
  it("sets the standup rules, word budget and the user's own instructions", () => {
    expect(system).toContain("**Yesterday**, **Today**, **Blockers**");
    expect(system).toContain("Keep it under 120 words.");
    expect(system).toContain("Additional instructions from the developer: Write in Hebrew.");
  });
  it("describes done work per project with line stats", () => {
    expect(lines[0]).toBe("DEVELOPER: Itamar");
    expect(lines).toContain("DONE (Thu, Nov 5 → today):");
    expect(lines).toContain("## rundown (+200/-4 lines across 2 commits)");
    expect(lines).toContain("- commit: feat(core): add daemon [feat/daemon]");
    expect(lines).toContain("- merged PR #42 Add daemon");
    expect(lines).toContain("- reviewed PR #7 Speed up indexer (approved)");
    expect(lines).toContain("- agent session (claude, 4 prompts): Investigate flaky crawler");
  });
  it("includes timed meetings and notable commands, not all-day events", () => {
    expect(lines).toContain("## meetings");
    expect(lines).toContain("- Standup");
    expect(prompt).not.toContain("Holiday");
    expect(lines).toContain("- ran: git push origin main");
  });
  it("lists today's plan and the evidenced blockers", () => {
    expect(lines).toContain("TODAY (Sun, Nov 8):");
    expect(lines).toContain("- 10:00 meeting: Sprint planning");
    expect(lines).toContain("- my open PR #43 Web view polish (changes requested)");
    expect(lines).toContain("- review requested: #9 Refactor");
    expect(lines).toContain("- assigned issue ENG-13 Backlog thing (todo)");
    expect(lines.slice(lines.indexOf("BLOCKERS:") + 1)).toEqual([
      '- #43 "Web view polish" has changes requested',
      '- #44 "Cache eviction" waiting on review for 3 days',
    ]);
  });
  it("is deterministic, so the summary cache can key on it", () => {
    expect(
      buildPrompt(fixtureBrief, cal, { maxWords: 120, instructions: "Write in Hebrew." }).prompt,
    ).toBe(prompt);
  });
  it("uses the weekly prompt for week briefs", () => {
    const week = buildPrompt({ ...fixtureBrief, kind: "week", plan: undefined } as Brief, cal, {
      maxWords: 200,
    });
    expect(week.system).toContain("weekly summary");
    expect(week.prompt).not.toContain("BLOCKERS:");
  });
});
