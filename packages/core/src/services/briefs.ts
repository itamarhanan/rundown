import { Context, Effect, Layer } from "effect";
import { RundownConfig } from "../config/load";
import { type Activity, inWindow } from "../domain/activity";
import {
  type Brief,
  type BriefKind,
  type DayCount,
  type Plan,
  type Recap,
  type Summary,
  groupByProject,
  inferBlockers,
} from "../domain/brief";
import { renderDigest } from "../domain/digest";
import {
  type LabeledWindow,
  dayWindow,
  formatDay,
  localParts,
  makeCalendar,
  nowDate,
  parseLocalDate,
  sinceLastWorkday,
  weekWindow,
} from "../domain/window";
import { BriefError, type CacheError } from "../errors";
import type { SourceReport } from "../sources/source";
import { Aggregator } from "./aggregator";
import { Cache } from "./cache";
import { Summarizer } from "./summarizer";
export interface BriefOptions {
  readonly date?: string;
  readonly weekOffset?: number;
  readonly refresh?: boolean;
  readonly llm?: boolean;
  readonly onReport?: (report: SourceReport) => void;
}
export class Briefs extends Context.Tag("rundown/Briefs")<
  Briefs,
  {
    readonly build: (kind: BriefKind, opts?: BriefOptions) => Effect.Effect<Brief, BriefError>;
    readonly saveEdit: (briefKey: string, text: string) => Effect.Effect<void, CacheError>;
    readonly clearEdit: (briefKey: string) => Effect.Effect<void, CacheError>;
  }
>() {
  static readonly Live = Layer.effect(
    Briefs,
    Effect.gen(function* () {
      const cfg = yield* RundownConfig;
      const aggregator = yield* Aggregator;
      const cache = yield* Cache;
      const summarizer = yield* Summarizer;
      const cal = makeCalendar(cfg.user.timezone, cfg.user.workdays);
      const windowsFor = (kind: BriefKind, now: Date, opts: BriefOptions) => {
        const today = dayWindow(cal, now);
        const day = opts.date ? parseLocalDate(cal, opts.date) : undefined;
        if (opts.date && !day)
          throw new BriefError({ message: `invalid date "${opts.date}", expected YYYY-MM-DD` });
        const recap: LabeledWindow | undefined =
          kind === "week"
            ? weekWindow(cal, now, opts.weekOffset ?? 0)
            : kind === "today"
              ? undefined
              : day
                ? dayWindow(cal, day)
                : sinceLastWorkday(cal, now);
        const plan =
          kind === "today" || kind === "morning" ? (day ? dayWindow(cal, day) : today) : undefined;
        return { recap, plan, today };
      };
      const perDay = (activities: readonly Activity[]): DayCount[] => {
        const days = new Map<string, DayCount>();
        for (const a of activities) {
          const p = localParts(cal, a.timestamp);
          const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
          const d = days.get(key);
          days.set(key, {
            key,
            label: d?.label ?? formatDay(cal, a.timestamp),
            count: (d?.count ?? 0) + 1,
          });
        }
        return [...days.values()].sort((a, b) => a.key.localeCompare(b.key));
      };
      const summarize = (brief: Brief, opts: BriefOptions) =>
        Effect.gen(function* () {
          const digest = renderDigest(brief, cal);
          if (!opts.refresh) {
            const edited = yield* cache.edit(brief.key).pipe(Effect.orElseSucceed(() => undefined));
            if (edited) return { text: edited, origin: "edited", cached: true } satisfies Summary;
          } else {
            yield* cache.clearEdit(brief.key).pipe(Effect.ignore);
          }
          const empty = (brief.recap?.activities.length ?? 0) === 0 && !brief.plan?.meetings.length;
          if (opts.llm === false || empty)
            return { text: digest, origin: "digest", cached: false } satisfies Summary;
          if (!summarizer.availability.ok) {
            return {
              text: digest,
              origin: "digest",
              cached: false,
              note: summarizer.availability.reason,
            } satisfies Summary;
          }
          const hash = summarizer.hashFor(brief);
          if (!opts.refresh) {
            const hit = yield* cache.summary(hash).pipe(Effect.orElseSucceed(() => undefined));
            if (hit)
              return {
                text: hit.text,
                origin: "llm",
                model: hit.model,
                cached: true,
              } satisfies Summary;
          }
          return yield* summarizer.summarize(brief).pipe(
            Effect.tap((g) =>
              cache.saveSummary(g.hash, { text: g.text, model: g.model }).pipe(Effect.ignore),
            ),
            Effect.map((g): Summary => ({
              text: g.text,
              origin: "llm",
              model: g.model,
              cached: false,
            })),
            Effect.catchAll((e) =>
              Effect.succeed<Summary>({
                text: digest,
                origin: "digest",
                cached: false,
                note: e.message,
              }),
            ),
          );
        });
      const build = (kind: BriefKind, opts: BriefOptions = {}) =>
        Effect.gen(function* () {
          const now = yield* nowDate;
          const w = yield* Effect.try({
            try: () => windowsFor(kind, now, opts),
            catch: (e) => (e instanceof BriefError ? e : new BriefError({ message: String(e) })),
          });
          const start = new Date(
            Math.min(...[w.recap, w.plan].filter(Boolean).map((x) => x!.start.getTime())),
          );
          const end = new Date(
            Math.max(...[w.recap, w.plan].filter(Boolean).map((x) => x!.end.getTime())),
          );
          const collected = yield* aggregator.collect(
            { start, end },
            { open: Boolean(w.plan), ...(opts.onReport ? { onReport: opts.onReport } : {}) },
          );
          yield* cache.saveActivities(collected.activities).pipe(Effect.ignore);
          let recap: Recap | undefined;
          if (w.recap) {
            const acts = collected.activities.filter((a) => inWindow(a.timestamp, w.recap!));
            recap = {
              window: w.recap,
              activities: acts,
              projects: groupByProject(acts),
              meetings: acts.filter((a) => a.type === "meeting"),
              commands: acts.filter((a) => a.type === "command"),
              ...(kind === "week" ? { days: perDay(acts) } : {}),
            };
          }
          let plan: Plan | undefined;
          if (w.plan) {
            const acts = collected.activities.filter((a) => inWindow(a.timestamp, w.plan!));
            const meetings = acts.filter((a) => a.type === "meeting");
            plan = {
              window: w.plan,
              meetings,
              sofar: acts.filter((a) => a.type !== "meeting"),
              authored: collected.open.filter((o) => o.kind === "pr-authored"),
              reviews: collected.open.filter((o) => o.kind === "review-requested"),
              issues: collected.open.filter((o) => o.kind === "issue-assigned"),
            };
          }
          const anchor = kind === "week" ? w.recap! : kind === "yesterday" ? w.recap! : w.plan!;
          const draft: Brief = {
            kind,
            key: `${kind}:${anchor.key}`,
            generatedAt: now,
            user: { name: cfg.user.name, timeZone: cfg.user.timezone },
            ...(recap ? { recap } : {}),
            ...(plan ? { plan } : {}),
            blockers: inferBlockers(plan, now),
            summary: { text: "", origin: "digest", cached: false },
            reports: collected.reports,
          };
          return { ...draft, summary: yield* summarize(draft, opts) } satisfies Brief;
        });
      return {
        build,
        saveEdit: (key, text) => cache.saveEdit(key, text.trim()),
        clearEdit: (key) => cache.clearEdit(key),
      };
    }),
  );
}
