import {
  Aggregator,
  type SourceReport,
  dayWindow,
  makeCalendar,
  nowDate,
  RundownConfig,
  sinceLastWorkday,
} from "@rundown/core";
import { defineCommand } from "citty";
import { Effect } from "effect";
import { styleText } from "node:util";
import { disposeRuntime, run } from "../runtime";
const mark = (status: "ok" | "skipped" | "failed") =>
  status === "ok"
    ? styleText("green", "✓")
    : status === "failed"
      ? styleText("red", "✗")
      : styleText("gray", "–");
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const list = defineCommand({
  meta: {
    name: "list",
    description: "Which sources are configured and detected (no fetching)",
  },
  async run() {
    const lines = await run(Effect.flatMap(Aggregator, (a) => a.detectAll));
    for (const l of lines) {
      process.stdout.write(
        `${mark(l.detection.available ? "ok" : "skipped")} ${pad(l.label, 16)} ${styleText("gray", l.detection.detail)}\n`,
      );
    }
    await disposeRuntime();
  },
});
const test = defineCommand({
  meta: {
    name: "test",
    description: "Fetch from every source and report counts, timings, and errors",
  },
  async run() {
    const result = await run(
      Effect.gen(function* () {
        const cfg = yield* RundownConfig;
        const cal = makeCalendar(cfg.user.timezone, cfg.user.workdays);
        const now = yield* nowDate;
        const window = {
          start: sinceLastWorkday(cal, now).start,
          end: dayWindow(cal, now).end,
        };
        const aggregator = yield* Aggregator;
        return yield* aggregator.collect(window, { open: true });
      }),
    );
    const show = (r: SourceReport) => {
      const count = r.status === "ok" ? pad(String(r.count), 5) : pad("", 5);
      const ms = r.durationMs ? `${r.durationMs}ms` : "";
      process.stdout.write(
        `${mark(r.status)} ${pad(r.label, 16)} ${count} ${pad(ms, 8)} ${styleText("gray", r.detail)}\n`,
      );
      if (r.hint) process.stdout.write(`  ${styleText("yellow", `↳ ${r.hint}`)}\n`);
    };
    result.reports.forEach(show);
    const failed = result.reports.filter((r) => r.status === "failed").length;
    process.stdout.write(
      `\n${result.activities.length} activities, ${result.open.length} open items since your last workday` +
        (failed ? styleText("red", `, ${failed} source${failed > 1 ? "s" : ""} failed`) : "") +
        "\n",
    );
    await disposeRuntime();
    if (failed) process.exitCode = 1;
  },
});
export default defineCommand({
  meta: {
    name: "sources",
    description: "Inspect and test your activity sources",
  },
  subCommands: { list, test },
  default: "list",
});
