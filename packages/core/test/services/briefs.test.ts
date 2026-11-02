import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, TestClock } from "effect";
import {
  type Activity,
  AgentRegistry,
  AgentService,
  type AgentAdapter,
  Aggregator,
  Briefs,
  Cache,
  type DateWindow,
  RundownConfig,
  type Source,
  SourceError,
  Sources,
  Summarizer,
  detected,
  inWindow,
  notDetected,
  probe,
} from "../../src";
import { act, at, openItem } from "../helpers";
const NOW = at("2026-11-08T07:00:00Z");
const activities: Activity[] = [
  act({
    type: "commit",
    timestamp: at("2026-11-04T10:00:00Z"),
    project: "rundown",
    title: "before the window",
  }),
  act({
    type: "commit",
    timestamp: at("2026-11-05T08:00:00Z"),
    project: "rundown",
    title: "feat: daemon",
    metadata: { additions: 10, deletions: 1 },
  }),
  act({
    type: "commit",
    timestamp: at("2026-11-05T09:00:00Z"),
    project: "rundown",
    title: "test: daemon",
  }),
  act({
    type: "pr-merged",
    timestamp: at("2026-11-07T10:00:00Z"),
    project: "rundown",
    title: "Add daemon",
    metadata: { ref: "#42" },
  }),
  act({
    type: "pr-reviewed",
    timestamp: at("2026-11-05T12:00:00Z"),
    project: "nautilus",
    title: "Indexer",
    metadata: { ref: "#7" },
  }),
  act({ type: "meeting", timestamp: at("2026-11-05T07:30:00Z"), title: "Thursday standup" }),
  act({ type: "meeting", timestamp: at("2026-11-08T08:00:00Z"), title: "Sprint planning" }),
  act({
    type: "commit",
    timestamp: at("2026-11-08T06:30:00Z"),
    project: "rundown",
    title: "early commit today",
  }),
];
const stub: Source = {
  id: "stub",
  label: "Stub",
  detect: Effect.succeed(detected("fixture")),
  activities: (w: DateWindow) => Effect.succeed(activities.filter((a) => inWindow(a.timestamp, w))),
  openItems: Effect.succeed([
    openItem({
      kind: "pr-authored",
      ref: "#43",
      title: "Polish",
      status: "changes requested",
      createdAt: at("2026-11-07T10:00:00Z"),
    }),
    openItem({
      kind: "pr-authored",
      ref: "#44",
      title: "Eviction",
      status: "awaiting review",
      createdAt: at("2026-11-04T10:00:00Z"),
    }),
    openItem({
      kind: "pr-authored",
      ref: "#45",
      title: "Fresh",
      status: "awaiting review",
      createdAt: at("2026-11-07T10:00:00Z"),
    }),
    openItem({ kind: "review-requested", ref: "#9", title: "Refactor" }),
  ]),
};
const broken: Source = {
  id: "broken",
  label: "Broken",
  detect: Effect.succeed(detected("always fails")),
  activities: () =>
    Effect.fail(
      new SourceError({ source: "broken", message: "401 Unauthorized", hint: "check your token" }),
    ),
};
const agent: AgentAdapter = {
  name: "fake",
  label: "Fake agent",
  detect: Effect.succeed(detected("fixture")),
  fetchSessions: (w) =>
    Effect.succeed(
      [
        {
          agent: "fake",
          id: "s1",
          title: "Agent work",
          start: at("2026-11-05T13:00:00Z"),
          end: at("2026-11-05T14:00:00Z"),
          prompts: 3,
        },
      ].filter((s) => inWindow(s.start, w)),
    ),
};
const TestLive = (
  sources: readonly Source[] = [stub, broken],
  adapters: readonly AgentAdapter[] = [agent],
) => {
  const config = RundownConfig.fromObject({
    user: { name: "Tester", timezone: "Asia/Jerusalem", workdays: [0, 1, 2, 3, 4] },
    llm: { enabled: false },
  });
  const agents = AgentService.Live.pipe(Layer.provideMerge(AgentRegistry.layer(adapters)));
  const aggregator = Aggregator.Live.pipe(
    Layer.provideMerge(Layer.merge(Sources.layer(sources), agents)),
  );
  return Briefs.Live.pipe(
    Layer.provideMerge(Layer.mergeAll(aggregator, Cache.memory, Summarizer.Live)),
    Layer.provideMerge(config),
  );
};
const atNow = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
  Effect.zipRight(TestClock.setTime(NOW.getTime()), eff);
describe("Briefs", () => {
  it.effect("yesterday on a Sunday covers Thursday through the weekend", () =>
    atNow(
      Effect.gen(function* () {
        const brief = yield* Effect.flatMap(Briefs, (b) => b.build("yesterday"));
        expect(brief.key).toBe("yesterday:2026-11-05");
        expect(brief.recap!.window.label).toBe("Thu, Nov 5 → today");
        expect(brief.recap!.window.start.toISOString()).toBe("2026-11-04T22:00:00.000Z");
        expect(brief.recap!.window.end.toISOString()).toBe("2026-11-07T22:00:00.000Z");
        const titles = brief.recap!.activities.map((a) => a.title);
        expect(titles).toContain("Add daemon");
        expect(titles).toContain("Agent work");
        expect(titles).not.toContain("before the window");
        expect(titles).not.toContain("early commit today");
        expect(brief.plan).toBeUndefined();
        expect(brief.blockers).toEqual([]);
      }).pipe(Effect.provide(TestLive())),
    ),
  );
  it.effect(
    "morning groups projects, plans today, infers blockers and reports failing sources",
    () =>
      atNow(
        Effect.gen(function* () {
          const brief = yield* Effect.flatMap(Briefs, (b) => b.build("morning"));
          expect(brief.key).toBe("morning:2026-11-08");
          expect(brief.generatedAt).toEqual(NOW);
          const projects = brief.recap!.projects.map((g) => [g.project, g.activities.length]);
          expect(projects).toEqual([
            ["rundown", 3],
            ["nautilus", 1],
            ["Other", 1],
          ]);
          expect(brief.recap!.meetings.map((m) => m.title)).toEqual(["Thursday standup"]);
          expect(brief.plan!.window.key).toBe("2026-11-08");
          expect(brief.plan!.meetings.map((m) => m.title)).toEqual(["Sprint planning"]);
          expect(brief.plan!.sofar.map((a) => a.title)).toEqual(["early commit today"]);
          expect(brief.plan!.authored.map((p) => p.ref)).toEqual(["#43", "#44", "#45"]);
          expect(brief.plan!.reviews.map((p) => p.ref)).toEqual(["#9"]);
          expect(brief.blockers).toEqual([
            '#43 "Polish" has changes requested',
            '#44 "Eviction" waiting on review for 3 days',
          ]);
          const reports = Object.fromEntries(brief.reports.map((r) => [r.id, r]));
          expect(reports.stub).toMatchObject({ status: "ok", count: 7 });
          expect(reports.broken).toMatchObject({
            status: "failed",
            detail: "401 Unauthorized",
            hint: "check your token",
          });
          expect(reports["agent:fake"]).toMatchObject({ status: "ok", count: 1 });
          expect(brief.summary.origin).toBe("digest");
          expect(brief.summary.note).toBe("LLM disabled in config (llm.enabled: false)");
          expect(brief.summary.text).toContain("**Yesterday** (Thu, Nov 5 → today)");
          expect(brief.summary.text).toContain("- Merged #42 Add daemon");
          expect(brief.summary.text).toContain("- Address review on #43 Polish");
        }).pipe(Effect.provide(TestLive())),
      ),
  );
  it.effect("saveEdit wins on the next build, until a refresh clears it", () =>
    atNow(
      Effect.gen(function* () {
        const briefs = yield* Briefs;
        const first = yield* briefs.build("morning");
        yield* briefs.saveEdit(first.key, "  - shipped the daemon\n");
        const edited = yield* briefs.build("morning");
        expect(edited.summary).toEqual({
          text: "- shipped the daemon",
          origin: "edited",
          cached: true,
        });
        expect((yield* briefs.build("yesterday")).summary.origin).toBe("digest");
        const refreshed = yield* briefs.build("morning", { refresh: true });
        expect(refreshed.summary.origin).toBe("digest");
        expect((yield* briefs.build("morning")).summary.origin).toBe("digest");
      }).pipe(Effect.provide(TestLive())),
    ),
  );
  it.effect("--date recaps that local day and plans it", () =>
    atNow(
      Effect.gen(function* () {
        const brief = yield* Effect.flatMap(Briefs, (b) =>
          b.build("morning", { date: "2026-11-05" }),
        );
        expect(brief.key).toBe("morning:2026-11-05");
        expect(brief.recap!.window.label).toBe("Thu, Nov 5");
        expect(brief.recap!.activities.map((a) => a.title)).not.toContain("Add daemon");
      }).pipe(Effect.provide(TestLive())),
    ),
  );
  it.effect("rejects a malformed date with a BriefError", () =>
    atNow(
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Effect.flatMap(Briefs, (b) => b.build("yesterday", { date: "11/05/2026" })),
        );
        expect(error._tag).toBe("BriefError");
        expect(error.message).toBe('invalid date "11/05/2026", expected YYYY-MM-DD');
      }).pipe(Effect.provide(TestLive())),
    ),
  );
  it.effect("week briefs count activity per local day", () =>
    atNow(
      Effect.gen(function* () {
        const brief = yield* Effect.flatMap(Briefs, (b) => b.build("week", { weekOffset: -1 }));
        expect(brief.key).toBe("week:2026-11-01");
        expect(brief.recap!.days!.map((d) => [d.key, d.count])).toEqual([
          ["2026-11-04", 1],
          ["2026-11-05", 5],
          ["2026-11-07", 1],
        ]);
        expect(brief.blockers).toEqual([]);
      }).pipe(Effect.provide(TestLive())),
    ),
  );
  it.effect("a brief with no activity still renders", () =>
    atNow(
      Effect.gen(function* () {
        const brief = yield* Effect.flatMap(Briefs, (b) => b.build("yesterday"));
        expect(brief.summary.text).toContain("- Nothing logged.");
      }).pipe(Effect.provide(TestLive([], []))),
    ),
  );
});
describe("probe", () => {
  const src = { id: "x", label: "X", detect: Effect.succeed(detected("ready")) };
  it.effect("reports ok with count and elapsed time", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        probe(src, Effect.delay(Effect.succeed([1, 2, 3]), Duration.millis(250))),
      );
      yield* TestClock.adjust(Duration.millis(250));
      const p = yield* Fiber.join(fiber);
      expect(p.value).toEqual([1, 2, 3]);
      expect(p.report).toEqual({
        id: "x",
        label: "X",
        status: "ok",
        detail: "ready",
        count: 3,
        durationMs: 250,
      });
    }),
  );
  it.effect("turns a failure into a failed report with its hint", () =>
    Effect.gen(function* () {
      const p = yield* probe(
        src,
        Effect.fail(new SourceError({ source: "x", message: "boom", hint: "try again" })),
      );
      expect(p.value).toEqual([]);
      expect(p.report).toMatchObject({
        status: "failed",
        detail: "boom",
        hint: "try again",
        count: 0,
      });
    }),
  );
  it.effect("turns a defect into a failed report instead of crashing", () =>
    Effect.gen(function* () {
      const p = yield* probe(src, Effect.die(new Error("kaboom")));
      expect(p.report).toMatchObject({ status: "failed", detail: "kaboom" });
    }),
  );
  it.effect("times out a slow source", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(probe(src, Effect.never, Duration.seconds(5)));
      yield* TestClock.adjust(Duration.seconds(5));
      const p = yield* Fiber.join(fiber);
      expect(p.report).toMatchObject({
        status: "failed",
        detail: "timed out after 5s",
        durationMs: 5000,
      });
    }),
  );
  it.effect("skips an undetected source without fetching", () =>
    Effect.gen(function* () {
      let fetched = false;
      const p = yield* probe(
        { ...src, detect: Effect.succeed(notDetected("no token")) },
        Effect.sync(() => {
          fetched = true;
          return [1];
        }),
      );
      expect(fetched).toBe(false);
      expect(p.report).toEqual({
        id: "x",
        label: "X",
        status: "skipped",
        detail: "no token",
        count: 0,
        durationMs: 0,
      });
    }),
  );
});
