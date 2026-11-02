import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { plural } from "../lib/activity";
import { formatMinutes, sameDay } from "../lib/time";
import type { Activity, DayCount, ProjectGroup, Recap } from "../types";
import { ActivityRow } from "./ActivityRow";
import { Empty, Facts, LedgerSection } from "./common";
export const Receipts = ({
  recap,
  timeZone,
  label = "Receipts",
  id = "receipts",
}: {
  recap: Recap;
  timeZone: string;
  label?: string;
  id?: string;
}) => {
  const multiDay = !sameDay(
    recap.window.start,
    new Date(new Date(recap.window.end).getTime() - 1),
    timeZone,
  );
  const groups = recap.projects;
  const nothing = groups.length === 0 && recap.meetings.length === 0;
  return (
    <LedgerSection id={id} label={label} aside={recap.window.label}>
      {recap.days && recap.days.length > 0 && <WeekChart days={recap.days} />}
      {nothing ? (
        <Empty>
          Nothing logged for {recap.window.label}. No commits, pull requests or agent sessions
          turned up.
        </Empty>
      ) : (
        <div className="divide-y divide-hairline border-hairline border-y">
          {groups.map((g) => (
            <ProjectReceipt
              key={g.project}
              group={g}
              timeZone={timeZone}
              showDay={multiDay}
              open={groups.length === 1}
            />
          ))}
          {recap.meetings.length > 0 && (
            <MeetingsReceipt meetings={recap.meetings} timeZone={timeZone} showDay={multiDay} />
          )}
        </div>
      )}
    </LedgerSection>
  );
};
const Row = ({
  title,
  facts,
  diff,
  open,
  children,
}: {
  title: string;
  facts: readonly (string | false)[];
  diff?: string;
  open?: boolean;
  children: ReactNode;
}) => (
  <details className="group" open={open}>
    <summary className="flex cursor-pointer list-none items-baseline gap-3 py-2.5 hover:bg-fill/60 [&::-webkit-details-marker]:hidden">
      <ChevronRightIcon
        aria-hidden
        className="size-3.5 shrink-0 translate-y-0.5 text-content-tertiary transition-transform group-open:rotate-90"
      />
      <span className="min-w-0 flex-1 break-words">
        <span className="mr-3 font-semibold text-ui">{title}</span>
        <Facts items={facts} />
      </span>
      {diff && (
        <span className="shrink-0 font-mono text-caption text-content-tertiary tabular-nums">
          {diff}
        </span>
      )}
    </summary>
    <ul className="pb-3 pl-6.5">{children}</ul>
  </details>
);
const ProjectReceipt = ({
  group: g,
  timeZone,
  showDay,
  open,
}: {
  group: ProjectGroup;
  timeZone: string;
  showDay: boolean;
  open: boolean;
}) => (
  <Row
    title={g.project}
    open={open}
    facts={[
      g.prsMerged > 0 && `${g.prsMerged} merged`,
      g.prsOpened > 0 && `${g.prsOpened} opened`,
      g.prsReviewed > 0 && plural(g.prsReviewed, "review"),
      g.commits > 0 && plural(g.commits, "commit"),
      g.issues > 0 && plural(g.issues, "issue"),
      g.sessions > 0 && plural(g.sessions, "agent session"),
    ]}
    {...(g.additions + g.deletions > 0
      ? { diff: `+${g.additions.toLocaleString()} −${g.deletions.toLocaleString()}` }
      : {})}
  >
    {g.activities.map((a) => (
      <ActivityRow key={a.id} activity={a} timeZone={timeZone} showDay={showDay} />
    ))}
  </Row>
);
const MeetingsReceipt = ({
  meetings,
  timeZone,
  showDay,
}: {
  meetings: readonly Activity[];
  timeZone: string;
  showDay: boolean;
}) => {
  const minutes = meetings.reduce(
    (n, m) =>
      n + (m.end ? (new Date(m.end).getTime() - new Date(m.timestamp).getTime()) / 60000 : 0),
    0,
  );
  return (
    <Row
      title="Meetings"
      facts={[plural(meetings.length, "meeting"), minutes > 0 && formatMinutes(minutes)]}
    >
      {meetings.map((a) => (
        <ActivityRow key={a.id} activity={a} timeZone={timeZone} showDay={showDay} />
      ))}
    </Row>
  );
};
const WeekChart = ({ days }: { days: readonly DayCount[] }) => {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <ol aria-label="Activity per day" className="mb-4 flex h-28 items-end gap-2">
      {days.map((d) => (
        <li
          key={d.key}
          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
        >
          <span className="font-mono text-caption text-content-secondary tabular-nums">
            {d.count}
          </span>
          <span
            aria-hidden
            className="w-full max-w-12 rounded-t-sm bg-content-tertiary/70"
            style={{ height: `${Math.max(4, (d.count / max) * 64)}px` }}
          />
          <span className="w-full truncate text-center text-caption text-content-tertiary">
            <span className="sr-only">{d.label}: </span>
            <span aria-hidden>{d.label.split(",")[0]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
};
