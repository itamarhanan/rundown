import { makeCalendar } from "@rundown/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cronExpression,
  localDateKey,
  missedToday,
  preview,
  renderLaunchAgent,
  renderSystemdUnit,
  type Scheduler,
  startScheduler,
} from "../src/commands/daemon";
const cfg = (morningBrief: string, workdays: number[]) => ({
  schedule: { morningBrief, delivery: "notification" as const, port: 4477 },
  user: { name: "T", timezone: "Asia/Jerusalem", workdays },
});
const cal = makeCalendar("Asia/Jerusalem", [0, 1, 2, 3, 4]);
describe("cronExpression", () => {
  it("fires at the brief time on workdays only", () => {
    expect(cronExpression(cfg("08:30", [4, 0, 1, 2, 3, 0]))).toBe("30 8 * * 0,1,2,3,4");
    expect(cronExpression(cfg("7:05", [1]))).toBe("5 7 * * 1");
  });
  it("fires daily when no workdays are set", () => {
    expect(cronExpression(cfg("23:59", []))).toBe("59 23 * * *");
  });
});
describe("missedToday", () => {
  const c = cfg("08:30", [0, 1, 2, 3, 4]);
  const sun = (hhmm: string) => new Date(`2026-11-08T${hhmm}:00+02:00`);
  it("fires on a workday started after the brief time, once per local day", () => {
    expect(missedToday(c, cal, sun("08:30"))).toBe(true);
    expect(missedToday(c, cal, sun("23:59"), "2026-11-05")).toBe(true);
    expect(missedToday(c, cal, sun("10:00"), "2026-11-08")).toBe(false);
  });
  it("waits for the schedule before the brief time", () => {
    expect(missedToday(c, cal, sun("08:29"))).toBe(false);
  });
  it("never fires on a weekend", () => {
    expect(missedToday(c, cal, new Date("2026-11-07T10:00:00+02:00"))).toBe(false);
  });
  it("treats no configured workdays as every day, like the cron expression", () => {
    const daily = makeCalendar("Asia/Jerusalem", []);
    expect(missedToday(c, daily, new Date("2026-11-07T10:00:00+02:00"))).toBe(true);
  });
  it("keys days in the user's zone", () => {
    expect(localDateKey(cal, new Date("2026-11-07T23:30:00Z"))).toBe("2026-11-08");
  });
});
describe("preview", () => {
  it("takes the first top-level bullets as plain text", () => {
    const md = [
      "**Yesterday** (Thu, Nov 5)",
      "- **rundown**: 2 commits, 1 PR merged",
      "  - Merged #42 Add daemon",
      "- Reviewed [#7](https://github.com/acme/x/pull/7) `indexer`",
      "",
      "**Today**",
      "- 10:00 Sprint planning",
      "- Ship #43",
      "- Review #9",
      "",
      "**Blockers**",
      "- None",
    ].join("\n");
    expect(preview(md)).toBe(
      [
        "• rundown: 2 commits, 1 PR merged",
        "• Reviewed #7 indexer",
        "• 10:00 Sprint planning",
        "• Ship #43",
      ].join("\n"),
    );
  });
  it("falls back to plain lines, and never returns nothing", () => {
    expect(preview("## Done\nShipped it.")).toBe("Done\nShipped it.");
    expect(preview("")).toBe("Nothing logged.");
  });
});
describe("service files", () => {
  const env: [string, string][] = [["PATH", "/usr/bin:/opt/50%/bin"]];
  it("systemd unit runs `daemon`, reads the env file and escapes %", () => {
    const unit = renderSystemdUnit("/usr/bin/node", "/opt/rundown/dist/main.mjs", env);
    expect(unit).toContain("Managed by rundown");
    expect(unit).toContain('ExecStart="/usr/bin/node" "/opt/rundown/dist/main.mjs" daemon');
    expect(unit).toContain("EnvironmentFile=-%h/.config/rundown/env");
    expect(unit).toContain('Environment="PATH=/usr/bin:/opt/50%%/bin"');
    expect(unit).toContain("WantedBy=default.target");
  });
  it("LaunchAgent sources the env file and keeps the daemon alive", () => {
    const plist = renderLaunchAgent("/usr/local/bin/node", "/opt/it's here/main.mjs", [
      ["PATH", "/a&b"],
    ]);
    expect(plist).toContain("Managed by rundown");
    expect(plist).toContain(". &quot;$HOME/.config/rundown/env&quot;".replace(/&quot;/g, '"'));
    expect(plist).toContain("exec '/usr/local/bin/node' '/opt/it'\\''s here/main.mjs' daemon");
    expect(plist).toContain("<string>/a&amp;b</string>");
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });
});
describe("startScheduler", () => {
  const at = (iso: string) => new Date(`${iso}+02:00`);
  const MIN = 60000;
  let scheduler: Scheduler | undefined;
  let lastFired: string | undefined;
  let fired: string[];
  let logs: string[];
  const start = (
    fire: () => Promise<void> = async () => void fired.push(new Date().toISOString()),
  ) =>
    (scheduler = startScheduler({
      cfg: cfg("08:30", [0, 1, 2, 3, 4]),
      fire,
      readLastFired: () => lastFired,
      writeLastFired: (d) => void (lastFired = d),
      log: (m) => void logs.push(m),
    }));
  beforeEach(() => {
    vi.useFakeTimers();
    lastFired = undefined;
    fired = [];
    logs = [];
  });
  afterEach(async () => {
    await scheduler?.stop();
    scheduler = undefined;
    vi.useRealTimers();
  });
  it("fires once at the brief time and not again that day", async () => {
    vi.setSystemTime(at("2026-11-04T08:00:00"));
    start();
    await vi.advanceTimersByTimeAsync(29 * MIN);
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(fired).toEqual(["2026-11-04T06:30:00.000Z"]);
    expect(lastFired).toBe("2026-11-04");
    await vi.advanceTimersByTimeAsync(10 * 60 * MIN);
    expect(fired).toHaveLength(1);
  });
  it("skips non-workdays and resumes on the next workday", async () => {
    vi.setSystemTime(at("2026-11-06T08:00:00"));
    start();
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * MIN);
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(31 * MIN);
    expect(fired).toEqual(["2026-11-08T06:30:00.000Z"]);
  });
  it("delivers a brief missed while the machine slept, exactly once", async () => {
    vi.setSystemTime(at("2026-11-04T08:00:00"));
    start();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(fired).toEqual([]);
    vi.setSystemTime(at("2026-11-04T09:15:00"));
    await vi.advanceTimersByTimeAsync(MIN);
    expect(fired).toHaveLength(1);
    expect(logs.some((l) => l.includes("missed today's 08:30 brief"))).toBe(true);
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(fired).toHaveLength(1);
  });
  it("catches up on start after the brief time, unless already delivered today", async () => {
    vi.setSystemTime(at("2026-11-04T11:00:00"));
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fired).toHaveLength(1);
    await scheduler!.stop();
    start();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(fired).toHaveLength(1);
  });
  it("uses the user's time zone, not the machine's", async () => {
    vi.setSystemTime(new Date("2026-11-04T06:29:00Z"));
    start();
    await vi.advanceTimersByTimeAsync(MIN + 1000);
    expect(fired).toEqual(["2026-11-04T06:30:00.000Z"]);
  });
  it("survives a failing delivery or state write and still fires the next day", async () => {
    vi.setSystemTime(at("2026-11-04T08:29:00"));
    start(async () => {
      fired.push(new Date().toISOString());
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(fired).toHaveLength(1);
    expect(logs.some((l) => l.includes("boom"))).toBe(true);
    await vi.advanceTimersByTimeAsync(24 * 60 * MIN);
    expect(fired).toHaveLength(2);
  });
  it("logs a state write failure instead of crashing", async () => {
    vi.setSystemTime(at("2026-11-04T11:00:00"));
    scheduler = startScheduler({
      cfg: cfg("08:30", [0, 1, 2, 3, 4]),
      fire: async () => void fired.push("x"),
      readLastFired: () => undefined,
      writeLastFired: () => {
        throw new Error("EACCES");
      },
      log: (m) => void logs.push(m),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fired).toEqual([]);
    expect(logs.some((l) => l.includes("EACCES"))).toBe(true);
  });
  it("stops cleanly: no timers left firing", async () => {
    vi.setSystemTime(at("2026-11-04T08:00:00"));
    start();
    await scheduler!.stop();
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * MIN);
    expect(fired).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
