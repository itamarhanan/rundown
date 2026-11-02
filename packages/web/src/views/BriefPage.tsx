import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MinusIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { useRef } from "react";
import { ActivityRow } from "../components/ActivityRow";
import { Empty, Kbd, LedgerSection } from "../components/common";
import { PageHeader } from "../components/PageHeader";
import { Receipts } from "../components/Receipts";
import { SourceFooter } from "../components/SourceHealth";
import { Standup, type StandupHandle } from "../components/Standup";
import { TodayPlan } from "../components/TodayPlan";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useHotkeys } from "../lib/hotkeys";
import { hrefFor, Link, navigate } from "../lib/router";
import { dayKey, keyLabel, relativeTime, shiftDay } from "../lib/time";
import { useBrief } from "../lib/useBrief";
import { cn } from "../lib/utils";
import type { Brief, BriefKind, Meta, SourceReport } from "../types";
const TITLES: Record<BriefKind, string> = {
  morning: "Morning brief",
  yesterday: "Standup",
  today: "Today",
  week: "Week",
};
const SUBTITLES: Record<BriefKind, string> = {
  morning: "What you did since your last workday, and what's ahead",
  yesterday: "What you did since your last workday",
  today: "Your schedule and open work",
  week: "What you shipped this week",
};
export const BriefPage = ({
  kind,
  params,
  meta,
}: {
  kind: BriefKind;
  params: URLSearchParams;
  meta: Meta;
}) => {
  const date = params.get("date") ?? undefined;
  const last = params.get("last") === "1";
  const { state, reload, regenerate, retry } = useBrief(kind, {
    ...(date ? { date } : {}),
    ...(last ? { last } : {}),
  });
  const tz = meta.user.timeZone;
  const today = dayKey(new Date(), tz);
  const anchor =
    date ??
    (state.tag === "ready"
      ? kind === "yesterday"
        ? state.brief.recap?.window.key
        : state.brief.plan?.window.key
      : undefined);
  const step = (delta: number) => {
    if (!anchor || kind === "week") return;
    const next = shiftDay(anchor, delta);
    if (next > today || (delta > 0 && !date)) return;
    navigate(hrefFor(kind, next < today ? { date: next } : {}));
  };
  const keys = useRef<StandupHandle | undefined>(undefined);
  useHotkeys({
    c: () => keys.current?.copy(),
    e: () => keys.current?.edit(),
    r: () => keys.current?.regenerate(),
    "[": kind === "week" ? () => navigate(hrefFor("week", { last: "1" })) : () => step(-1),
    "]": kind === "week" ? () => navigate(hrefFor("week")) : () => step(1),
  });
  const routeKey = `${kind}|${date ?? ""}|${last}`;
  const subtitle =
    state.tag === "ready" ? (
      <>
        {windowLabel(state.brief)}
        <span className="text-content-tertiary">
          {" "}
          · generated {relativeTime(state.brief.generatedAt)}
        </span>
      </>
    ) : date ? (
      keyLabel(date)
    ) : (
      SUBTITLES[kind]
    );
  const actions =
    kind === "week" ? (
      <nav aria-label="Which week" className="inline-flex rounded-lg bg-fill p-0.5 text-ui">
        {[
          { label: "This week", href: hrefFor("week"), current: !last },
          {
            label: "Last week",
            href: hrefFor("week", { last: "1" }),
            current: last,
          },
        ].map((t) => (
          <Link
            key={t.label}
            href={t.href}
            aria-current={t.current ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-content-secondary hover:text-content",
              t.current && "bg-surface font-medium text-content shadow-xs",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    ) : (
      <>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous day"
          title="Previous day ( [ )"
          disabled={!anchor}
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next day"
          title="Next day ( ] )"
          disabled={!anchor || !date}
          onClick={() => step(1)}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
        {date && (
          <Button variant="outline" size="sm" render={<Link href={hrefFor(kind)} />}>
            Back to latest
          </Button>
        )}
      </>
    );
  return (
    <div className="space-y-8">
      <PageHeader title={TITLES[kind]} subtitle={subtitle} actions={actions} routeKey={routeKey} />

      {state.tag === "loading" && <Loading reports={state.reports} />}

      {state.tag === "error" && (
        <div role="alert" className="rounded-xl border border-hairline p-5">
          <p className="flex items-center gap-2 font-medium text-danger text-ui">
            <AlertTriangleIcon aria-hidden className="size-4" />
            Couldn't build this brief
          </p>
          <p className="mt-1 text-ui">{state.message}</p>
          {state.hint && <p className="mt-1 text-content-secondary text-ui">{state.hint}</p>}
          <Button size="sm" variant="outline" className="mt-4" onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      {state.tag === "ready" && (
        <BriefBody
          brief={state.brief}
          meta={meta}
          refreshing={state.refreshing}
          onSaved={reload}
          onRegenerate={regenerate}
          bindKeys={(h) => (keys.current = h)}
        />
      )}
    </div>
  );
};
const windowLabel = (b: Brief) =>
  (b.kind === "today" ? b.plan?.window.label : b.recap?.window.label) ?? "";
const BriefBody = ({
  brief,
  meta,
  refreshing,
  onSaved,
  onRegenerate,
  bindKeys,
}: {
  brief: Brief;
  meta: Meta;
  refreshing: boolean;
  onSaved: () => void;
  onRegenerate: () => void;
  bindKeys: (h: StandupHandle) => void;
}) => {
  const tz = meta.user.timeZone;
  const { recap, plan } = brief;
  return (
    <div
      className={cn("space-y-10 transition-opacity", refreshing && "opacity-60")}
      aria-busy={refreshing}
    >
      <div className="space-y-2">
        <Standup
          brief={brief}
          onSaved={onSaved}
          onRegenerate={onRegenerate}
          regenerating={refreshing}
          bindKeys={bindKeys}
        />
        <p className="hidden text-caption text-content-tertiary sm:block">
          <Kbd>C</Kbd> copy · <Kbd>E</Kbd> edit · <Kbd>R</Kbd> regenerate · <Kbd>[</Kbd>{" "}
          <Kbd>]</Kbd> {brief.kind === "week" ? "switch week" : "previous / next day"}
        </p>
      </div>

      {plan && <TodayPlan plan={plan} blockers={brief.blockers} timeZone={tz} now={new Date()} />}

      {brief.kind === "today" && plan && (
        <LedgerSection
          id="so-far"
          label="So far"
          aside={plan.sofar.length ? String(plan.sofar.length) : undefined}
        >
          {plan.sofar.length === 0 ? (
            <Empty>Nothing logged yet today.</Empty>
          ) : (
            <ul>
              {plan.sofar.map((a) => (
                <ActivityRow key={a.id} activity={a} timeZone={tz} />
              ))}
            </ul>
          )}
        </LedgerSection>
      )}

      {recap && <Receipts recap={recap} timeZone={tz} />}

      {brief.kind !== "week" && !plan && brief.blockers.length > 0 && (
        <LedgerSection id="blockers" label="Blockers">
          <ul className="space-y-1 text-danger text-ui">
            {brief.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </LedgerSection>
      )}

      <SourceFooter reports={brief.reports} />
    </div>
  );
};
const Loading = ({ reports }: { reports: readonly SourceReport[] }) => (
  <div className="space-y-6">
    <div className="rounded-xl border border-hairline p-6" aria-hidden>
      <Skeleton className="h-3 w-20" />
      <div className="mt-6 space-y-3">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-6 h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
    <div role="status" aria-live="polite" className="space-y-2">
      <p className="text-content-secondary text-ui">
        Collecting activity
        {reports.length ? ` · ${reports.length} sources answered` : "…"}
      </p>
      {reports.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-content-tertiary">
          {reports.map((r) => (
            <li
              key={r.id}
              className={cn(
                "inline-flex items-center gap-1",
                r.status === "failed" && "text-danger",
              )}
            >
              {r.status === "ok" ? (
                <CheckIcon aria-hidden className="size-3.5" />
              ) : r.status === "failed" ? (
                <AlertTriangleIcon aria-hidden className="size-3.5" />
              ) : (
                <MinusIcon aria-hidden className="size-3.5" />
              )}
              {r.label}
              {r.status === "ok" && <span className="font-mono tabular-nums">{r.count}</span>}
              {r.status === "failed" && <span className="sr-only">failed</span>}
              {r.status === "skipped" && <span className="sr-only">skipped</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
);
