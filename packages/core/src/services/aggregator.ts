import { Context, Effect, Layer } from "effect";
import { AgentService } from "../agents/registry";
import { sessionToActivity } from "../agents/agent";
import type { Activity, DateWindow, OpenItem } from "../domain/activity";
import { Sources } from "../sources/registry";
import { type Detection, type SourceReport, probe } from "../sources/source";
import { AgentRegistry } from "../agents/registry";
export interface CollectOptions {
  readonly open?: boolean;
  readonly onReport?: (report: SourceReport) => void;
}
export interface Collected {
  readonly activities: readonly Activity[];
  readonly open: readonly OpenItem[];
  readonly reports: readonly SourceReport[];
}
export interface SourceStatusLine {
  readonly id: string;
  readonly label: string;
  readonly detection: Detection;
}
const dedupe = <
  A extends {
    readonly id: string;
  },
>(
  items: readonly A[],
): A[] => {
  const seen = new Map<string, A>();
  for (const i of items) if (!seen.has(i.id)) seen.set(i.id, i);
  return [...seen.values()];
};
export class Aggregator extends Context.Tag("rundown/Aggregator")<
  Aggregator,
  {
    readonly collect: (window: DateWindow, opts?: CollectOptions) => Effect.Effect<Collected>;
    readonly detectAll: Effect.Effect<readonly SourceStatusLine[]>;
  }
>() {
  static readonly Live = Layer.effect(
    Aggregator,
    Effect.gen(function* () {
      const { all } = yield* Sources;
      const agents = yield* AgentService;
      const registry = yield* AgentRegistry;
      const collect = (window: DateWindow, opts: CollectOptions = {}) =>
        Effect.gen(function* () {
          const notify = (r: SourceReport) => Effect.sync(() => opts.onReport?.(r));
          const [sourceProbes, agentRun, openProbes] = yield* Effect.all(
            [
              Effect.forEach(
                all,
                (s) => Effect.tap(probe(s, s.activities(window)), (p) => notify(p.report)),
                {
                  concurrency: "unbounded",
                },
              ),
              agents.sessions(window, opts.onReport),
              opts.open
                ? Effect.forEach(
                    all.filter((s) => s.openItems),
                    (s) =>
                      probe({ ...s, id: `${s.id}:open`, label: `${s.label} (open)` }, s.openItems!),
                    { concurrency: "unbounded" },
                  )
                : Effect.succeed([]),
            ],
            { concurrency: "unbounded" },
          );
          const activities = dedupe([
            ...sourceProbes.flatMap((p) => p.value),
            ...agentRun.sessions.map(sessionToActivity),
          ]).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
          const open = dedupe(openProbes.flatMap((p) => p.value));
          const openFailures = openProbes.map((p) => p.report).filter((r) => r.status === "failed");
          return {
            activities,
            open,
            reports: [...sourceProbes.map((p) => p.report), ...agentRun.reports, ...openFailures],
          } satisfies Collected;
        });
      const detectAll = Effect.forEach(
        [
          ...all.map((s) => ({ id: s.id, label: s.label, detect: s.detect })),
          ...registry.adapters.map((a) => ({
            id: `agent:${a.name}`,
            label: a.label,
            detect: a.detect,
          })),
        ],
        (s) => Effect.map(s.detect, (detection) => ({ id: s.id, label: s.label, detection })),
        { concurrency: "unbounded" },
      );
      return { collect, detectAll };
    }),
  );
}
