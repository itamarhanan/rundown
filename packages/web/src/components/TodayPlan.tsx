import { AlertTriangleIcon, ExternalLinkIcon } from "lucide-react";
import { meta, shortRef, statusUrgency } from "../lib/activity";
import { formatSpan, formatTime } from "../lib/time";
import { cn } from "../lib/utils";
import type { Activity, Brief, OpenItem, Plan } from "../types";
import { Empty, LedgerSection, StatusText } from "./common";
export const TodayPlan = ({
  plan,
  blockers,
  timeZone,
  now,
}: {
  plan: Plan;
  blockers: Brief["blockers"];
  timeZone: string;
  now: Date;
}) => (
  <>
    <LedgerSection id="schedule" label="Schedule" aside={plan.window.label}>
      <Schedule meetings={plan.meetings} timeZone={timeZone} now={now} />
    </LedgerSection>
    <LedgerSection id="to-ship" label="To ship" aside={count(plan.authored)}>
      <OpenList items={plan.authored} empty="No open pull requests of yours." />
    </LedgerSection>
    <LedgerSection id="reviews" label="Reviews owed" aside={count(plan.reviews)}>
      <OpenList items={plan.reviews} empty="Nobody is waiting on your review." />
    </LedgerSection>
    {plan.issues.length > 0 && (
      <LedgerSection id="issues" label="Issues" aside={count(plan.issues)}>
        <OpenList items={plan.issues} empty="" />
      </LedgerSection>
    )}
    <LedgerSection id="blockers" label="Blockers">
      {blockers.length === 0 ? (
        <Empty>
          None found. Rundown flags your PRs with changes requested or waiting two days or more for
          review.
        </Empty>
      ) : (
        <ul className="space-y-2">
          {blockers.map((b) => (
            <li
              key={b}
              className="flex gap-2.5 rounded-lg bg-danger-fill px-3 py-2 text-danger text-ui"
            >
              <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">{b}</span>
            </li>
          ))}
        </ul>
      )}
    </LedgerSection>
  </>
);
const count = (items: readonly unknown[]) => (items.length ? String(items.length) : undefined);
const Schedule = ({
  meetings,
  timeZone,
  now,
}: {
  meetings: readonly Activity[];
  timeZone: string;
  now: Date;
}) => {
  const allDay = meetings.filter((m) => meta(m).allDay);
  const timed = meetings.filter((m) => !meta(m).allDay);
  if (meetings.length === 0) return <Empty>No meetings. A clear day for focus work.</Empty>;
  const t = now.getTime();
  const current = timed.find(
    (m) => new Date(m.timestamp).getTime() <= t && m.end && new Date(m.end).getTime() > t,
  );
  const next = current ? undefined : timed.find((m) => new Date(m.timestamp).getTime() > t);
  return (
    <div className="space-y-2">
      {allDay.length > 0 && (
        <p className="text-content-secondary text-ui">
          <span className="text-content-tertiary">All day: </span>
          {allDay.map((m) => m.title).join(" · ")}
        </p>
      )}
      <ol className="space-y-0.5">
        {timed.map((m) => {
          const past = m.end ? new Date(m.end).getTime() <= t : new Date(m.timestamp).getTime() < t;
          const marker = m === current ? "Now" : m === next ? "Next" : undefined;
          return (
            <li
              key={m.id}
              className={cn(
                "grid grid-cols-[11ch_minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-md px-2 py-1.5 -mx-2",
                marker && "bg-fill",
                past && "text-content-tertiary",
              )}
            >
              <span className="font-mono text-caption tabular-nums">
                <time dateTime={m.timestamp}>{formatTime(m.timestamp, timeZone)}</time>
                {m.end && (
                  <>
                    –<time dateTime={m.end}>{formatTime(m.end, timeZone)}</time>
                  </>
                )}
              </span>
              <span className="min-w-0 break-words text-ui">
                {marker && (
                  <span className="mr-2 font-semibold text-caption uppercase tracking-wide">
                    {marker}
                  </span>
                )}
                {m.title}
                {m.end && (
                  <span className="ml-2 text-caption text-content-tertiary">
                    {formatSpan(m.timestamp, m.end)}
                  </span>
                )}
              </span>
              {m.url ? (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-caption text-content-secondary underline-offset-2 hover:underline"
                >
                  Open<span className="sr-only"> {m.title}</span>
                  <ExternalLinkIcon aria-hidden className="size-3" />
                </a>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};
const OpenList = ({ items, empty }: { items: readonly OpenItem[]; empty: string }) => {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-0.5">
      {items.map((i) => (
        <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1">
          <span className="min-w-0 break-words text-ui">
            <a href={i.url} target="_blank" rel="noreferrer" className="group underline-offset-2">
              <span className="mr-2 font-mono text-caption text-content-secondary">
                {i.project && shortRef(i.ref).startsWith("#") && (
                  <span className="text-content-tertiary">{i.project}</span>
                )}
                {shortRef(i.ref)}
              </span>
              <span className="group-hover:underline">{i.title}</span>
            </a>
          </span>
          {i.status && <StatusText urgency={statusUrgency(i.status)}>{i.status}</StatusText>}
        </li>
      ))}
    </ul>
  );
};
