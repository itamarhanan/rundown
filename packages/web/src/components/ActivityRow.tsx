import type { ReactNode } from "react";
import { ACTIVITY_ICON, ACTIVITY_LABEL, capitalize, meta, plural, prLabel } from "../lib/activity";
import { formatDayTime, formatSpan, formatTime } from "../lib/time";
import type { Activity } from "../types";
import { Facts } from "./common";
export const ActivityRow = ({
  activity: a,
  timeZone,
  showDay = false,
}: {
  activity: Activity;
  timeZone: string;
  showDay?: boolean;
}) => {
  const Icon = ACTIVITY_ICON[a.type];
  const m = meta(a);
  const time = showDay ? formatDayTime(a.timestamp, timeZone) : formatTime(a.timestamp, timeZone);
  return (
    <li className="grid grid-cols-[auto_1rem_minmax(0,1fr)] items-baseline gap-x-3 py-1.5">
      <time
        dateTime={a.timestamp}
        className={`font-mono text-caption text-content-tertiary tabular-nums ${showDay ? "w-[9.5ch]" : "w-[5.5ch]"}`}
      >
        {time}
      </time>
      <Icon aria-hidden className="size-3.5 translate-y-0.5 text-content-tertiary" />
      <div className="min-w-0">
        <span className="sr-only">{ACTIVITY_LABEL[a.type]}: </span>
        {a.type === "agent-session" && m.agent && (
          <span className="mr-1.5 text-content-secondary text-ui">{capitalize(m.agent)}</span>
        )}
        {a.url ? (
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="break-words text-ui underline-offset-2 hover:underline"
          >
            {a.title}
          </a>
        ) : (
          <span className="break-words text-ui">{a.title}</span>
        )}
        <Details activity={a} />
      </div>
    </li>
  );
};
const Details = ({ activity: a }: { activity: Activity }) => {
  const m = meta(a);
  const bits: ReactNode[] = [];
  if (m.ref) bits.push(<span className="font-mono">{m.ref}</span>);
  if (m.review) bits.push(m.review);
  if (a.type === "commit" && (m.additions !== undefined || m.deletions !== undefined)) {
    bits.push(
      <span className="font-mono tabular-nums">
        +{m.additions ?? 0} −{m.deletions ?? 0}
      </span>,
    );
  }
  if (m.branch) bits.push(<span className="font-mono">{m.branch}</span>);
  if (a.type === "agent-session" && m.prompts !== undefined) bits.push(plural(m.prompts, "prompt"));
  if ((a.type === "agent-session" || a.type === "meeting") && a.end)
    bits.push(formatSpan(a.timestamp, a.end));
  for (const url of m.prs) {
    bits.push(
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="font-mono underline-offset-2 hover:underline"
      >
        {prLabel(url)}
      </a>,
    );
  }
  return bits.length ? <Facts items={bits} className="mt-0.5 flex" /> : null;
};
