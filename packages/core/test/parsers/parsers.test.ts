import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  eventsInWindow,
  parseAiderHistory,
  parseClaudeSession,
  parseCodexRollout,
  parseGitLog,
  readHistory,
} from "../../src";
const fixture = (name: string) => path.join(import.meta.dirname, "../fixtures", name);
const utcDay = (iso: string) => ({
  start: new Date(`${iso}T00:00:00Z`),
  end: new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86400000),
});
describe("parseGitLog", () => {
  const RS = "\x1e";
  const US = "\x1f";
  const header = (...f: string[]) => `${RS}${f.join(US)}`;
  const raw = [
    header(
      "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
      "Itamar",
      "itamar@example.com",
      "2026-11-05T10:15:00+02:00",
      "refs/heads/feat/daemon",
      "feat(cli): add daemon: schedule | notify",
    ),
    "12\t3\tpackages/cli/src/commands/daemon.ts",
    "-\t-\tdocs/logo.png",
    "0\t40\tpackages/cli/src/old.ts",
    "",
    header(
      "ffffffffffffffffffffffffffffffffffffffff",
      "Itamar (aider)",
      "itamar@example.com",
      "2026-11-05T11:00:00Z",
      "refs/remotes/origin/main",
      "fix: typo",
    ),
    "",
    header("not-a-hash", "x", "x", "2026-11-05T11:00:00Z", "", "garbage"),
  ].join("\n");
  const commits = parseGitLog(raw);
  it("parses headers, keeping separators-free subjects intact", () => {
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      hash: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
      author: "Itamar",
      email: "itamar@example.com",
      ref: "refs/heads/feat/daemon",
      subject: "feat(cli): add daemon: schedule | notify",
    });
    expect(commits[0]!.date.toISOString()).toBe("2026-11-05T08:15:00.000Z");
  });
  it("parses numstat, counting binary files as zero lines", () => {
    expect(commits[0]!.files).toEqual([
      { path: "packages/cli/src/commands/daemon.ts", additions: 12, deletions: 3 },
      { path: "docs/logo.png", additions: 0, deletions: 0 },
      { path: "packages/cli/src/old.ts", additions: 0, deletions: 40 },
    ]);
    expect(commits[1]!.files).toEqual([]);
  });
  it("returns nothing for empty output", () => {
    expect(parseGitLog("")).toEqual([]);
  });
});
describe("parseClaudeSession", () => {
  it("counts real prompts inside the window and ignores tool results, meta, commands and sidechains", async () => {
    const s = await parseClaudeSession(fixture("claude-session.jsonl"), utcDay("2026-11-05"));
    expect(s).toEqual({
      agent: "claude",
      id: "claude-session",
      title: "Build the rundown daemon",
      start: new Date("2026-11-05T08:00:00.000Z"),
      end: new Date("2026-11-05T09:45:00.000Z"),
      prompts: 2,
      cwd: "/home/dev/work/rundown",
      branch: "feat/daemon",
      model: "claude-opus-5-5",
      prs: ["https://github.com/acme/rundown/pull/12"],
      prompt: "Add a daemon command that schedules the morning brief",
    });
  });
  it("keeps the session title on later days but counts only that day's prompts", async () => {
    const s = await parseClaudeSession(fixture("claude-session.jsonl"), utcDay("2026-11-06"));
    expect(s).toMatchObject({ title: "Build the rundown daemon", prompts: 1 });
    expect(s).not.toHaveProperty("prs");
    expect(s!.start.toISOString()).toBe("2026-11-06T10:00:00.000Z");
  });
  it("returns undefined when nothing happened in the window", async () => {
    expect(
      await parseClaudeSession(fixture("claude-session.jsonl"), utcDay("2026-11-01")),
    ).toBeUndefined();
  });
});
describe("parseCodexRollout", () => {
  const file = fixture("codex-rollout.jsonl");
  it("reads meta, model and real prompts; skips the environment preamble", async () => {
    const s = await parseCodexRollout(file, utcDay("2026-11-05"));
    expect(s).toEqual({
      agent: "codex",
      id: "0199a1b2-c3d4",
      title: "Fix the flaky scheduler test",
      prompt: "Fix the flaky scheduler test\nit fails on CI about 1 in 5 runs",
      start: new Date("2026-11-05T10:00:01.000Z"),
      end: new Date("2026-11-05T10:21:00.000Z"),
      prompts: 2,
      cwd: "/home/dev/work/nautilus",
      model: "gpt-5-codex",
      branch: "fix/scheduler",
    });
  });
  it("prefers the thread name Codex generated", async () => {
    const s = await parseCodexRollout(
      file,
      utcDay("2026-11-05"),
      new Map([["0199a1b2-c3d4", "Deflake scheduler"]]),
    );
    expect(s?.title).toBe("Deflake scheduler");
  });
  it("returns undefined outside the window", async () => {
    expect(await parseCodexRollout(file, utcDay("2026-11-07"))).toBeUndefined();
  });
});
describe("parseAiderHistory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-aider-"));
  const file = path.join(dir, ".aider.chat.history.md");
  fs.copyFileSync(fixture("aider.chat.history.md"), file);
  const mtime = new Date(2026, 10, 6, 11, 0, 0);
  fs.utimesSync(file, mtime, mtime);
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  it("splits sessions at headers, drops prompt-less ones, and ends each at the next header", async () => {
    const sessions = await parseAiderHistory(file, {
      start: new Date(2026, 10, 5),
      end: new Date(2026, 10, 6),
    });
    expect(sessions).toEqual([
      {
        agent: "aider",
        id: `${dir}@${new Date(2026, 10, 5, 9).getTime()}`,
        title: "Refactor the cache layer into its own module",
        start: new Date(2026, 10, 5, 9),
        end: new Date(2026, 10, 5, 14),
        cwd: dir,
        prompts: 2,
      },
    ]);
  });
  it("ends the last session at the file's mtime", async () => {
    const [s] = await parseAiderHistory(file, {
      start: new Date(2026, 10, 6),
      end: new Date(2026, 10, 7),
    });
    expect(s).toMatchObject({ title: "Rename the package to @acme/cache", prompts: 1, end: mtime });
  });
  it("includes a session that started before the window but ran into it", async () => {
    const sessions = await parseAiderHistory(file, {
      start: new Date(2026, 10, 5, 12),
      end: new Date(2026, 10, 5, 13),
    });
    expect(sessions.map((s) => s.prompts)).toEqual([2]);
  });
});
describe("eventsInWindow", () => {
  const ics = fs.readFileSync(fixture("calendar.ics"), "utf8");
  const ilDay = (iso: string) => {
    const start = new Date(`${iso}T00:00:00+02:00`);
    return { start, end: new Date(start.getTime() + 86400000) };
  };
  const opts = { timeZone: "Asia/Jerusalem", email: "me@example.com" };
  it("expands the recurring series, keeps all-day and UTC events, drops declined and cancelled", () => {
    const events = eventsInWindow(ics, ilDay("2026-11-08"), opts);
    expect(events.map((e) => [e.summary, e.start.toISOString(), e.allDay])).toEqual([
      ["Company offsite", "2026-11-07T22:00:00.000Z", true],
      ["Daily standup", "2026-11-08T07:30:00.000Z", false],
      ["Design review, API", "2026-11-08T12:00:00.000Z", false],
    ]);
  });
  it("parses recurring event details, ignoring nested alarms and unfolding lines", () => {
    const standup = eventsInWindow(ics, ilDay("2026-11-08"), opts).find(
      (e) => e.uid === "standup-1@google.com",
    )!;
    expect(standup).toMatchObject({
      recurring: true,
      organizer: "lead@example.com",
      meetingUrl: "https://meet.google.com/std-upxx-abc",
      attendees: [{ email: "me@example.com", status: "ACCEPTED" }],
    });
    expect(standup.end.toISOString()).toBe("2026-11-08T07:45:00.000Z");
    expect(standup.description).toBeUndefined();
  });
  it("unescapes text and finds the meeting link in a folded description", () => {
    const design = eventsInWindow(ics, ilDay("2026-11-08"), opts).find(
      (e) => e.uid === "design@google.com",
    )!;
    expect(design.description).toBe(
      "Agenda:\n- API shape, naming\nJoin: https://meet.google.com/abc-defg-hij",
    );
    expect(design.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(design.location).toBe("Room 3");
    expect(design.recurring).toBe(false);
  });
  it("keeps the wall-clock time across the DST change", () => {
    const [first] = eventsInWindow(
      ics,
      { start: new Date("2026-10-17T21:00:00Z"), end: new Date("2026-10-18T21:00:00Z") },
      opts,
    );
    expect(first?.start.toISOString()).toBe("2026-10-18T06:30:00.000Z");
  });
  it("honours EXDATE, and RECURRENCE-ID overrides replace their occurrence", () => {
    expect(eventsInWindow(ics, ilDay("2026-11-09"), opts).map((e) => e.summary)).toEqual([
      "Tomorrow",
    ]);
    const tue = eventsInWindow(ics, ilDay("2026-11-10"), opts);
    expect(tue.map((e) => [e.summary, e.start.toISOString(), e.recurring])).toEqual([
      ["Daily standup (moved)", "2026-11-10T09:00:00.000Z", true],
    ]);
  });
  it("uses DURATION when there is no DTEND, and skips weekend days not in BYDAY", () => {
    const [tomorrow] = eventsInWindow(ics, ilDay("2026-11-09"), opts);
    expect(tomorrow!.end.toISOString()).toBe("2026-11-09T15:45:00.000Z");
    expect(eventsInWindow(ics, ilDay("2026-11-13"), opts)).toEqual([]);
  });
  it("shows declined events when hideDeclined is off", () => {
    const events = eventsInWindow(ics, ilDay("2026-11-08"), { ...opts, hideDeclined: false });
    expect(events.map((e) => e.summary)).toContain("Optional sync");
  });
});
describe("readHistory", () => {
  const all = async (name: string) => {
    const out: {
      at: string;
      command: string;
    }[] = [];
    for await (const e of readHistory(fixture(name)))
      out.push({ at: e.at.toISOString(), command: e.command });
    return out;
  };
  const t = (s: number) => new Date(s * 1000).toISOString();
  it("reads zsh extended history", async () => {
    expect(await all("zsh_history")).toEqual([
      { at: t(1762329600), command: "git status" },
      { at: t(1762329700), command: "git push origin main" },
    ]);
  });
  it("reads bash history with HISTTIMEFORMAT stamps, skipping unstamped lines", async () => {
    expect(await all("bash_history")).toEqual([
      { at: t(1762329600), command: "gh pr create --fill" },
      { at: t(1762329800), command: "ls -la" },
    ]);
  });
  it("reads fish history", async () => {
    expect(await all("fish_history")).toEqual([
      { at: t(1762329900), command: "git push" },
      { at: t(1762330000), command: "echo hi" },
    ]);
  });
});
