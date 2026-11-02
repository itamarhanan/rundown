import {
  type Activity,
  type Brief,
  type Calendar,
  type DayCount,
  type OpenItem,
  type ProjectGroup,
  type SourceReport,
  formatDay,
  formatTime,
  groupByProject,
  makeCalendar,
} from "@rundown/core";
import { Box, Text } from "ink";
import { type ReactNode, createContext, useContext } from "react";
import { Markdown } from "./markdown";
import { Label, Notice, Para, StatusWord, tone } from "./theme";
export interface ViewState {
  readonly details: boolean;
  readonly sources: boolean;
}
export const TITLE: Record<Brief["kind"], string> = {
  morning: "Morning brief",
  yesterday: "Standup",
  today: "Today",
  week: "Week",
};
export const LIST_LIMIT = 6;
export const KeysLive = createContext(false);
const GLYPH: Record<Activity["type"], string> = {
  commit: "•",
  "pr-opened": "↑",
  "pr-merged": "✓",
  "pr-reviewed": "◎",
  issue: "◇",
  "agent-session": "✦",
  meeting: "◷",
  command: "$",
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutes = (start: Date, end: Date) =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
const span = (mins: number) => {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};
const Section = ({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: string | undefined;
  children: ReactNode;
}) => (
  <Box flexDirection="column" marginTop={1}>
    <Label aside={aside}>{label}</Label>
    <Box flexDirection="column" paddingLeft={2}>
      {children}
    </Box>
  </Box>
);
const Empty = ({ children }: { children: ReactNode }) => <Para dimColor>{children}</Para>;
const Row = ({
  lead,
  leadWidth,
  gap = 1,
  children,
  trail,
}: {
  lead: ReactNode;
  leadWidth?: number;
  gap?: number;
  children: ReactNode;
  trail?: ReactNode;
}) => (
  <Box>
    <Box flexShrink={0} {...(leadWidth ? { width: leadWidth } : { marginRight: gap })}>
      {lead}
    </Box>
    <Box flexGrow={1} flexShrink={1}>
      <Para>{children}</Para>
    </Box>
    {trail ? (
      <Box flexShrink={0} marginLeft={1}>
        {trail}
      </Box>
    ) : null}
  </Box>
);
export const Provenance = ({ brief }: { brief: Brief }) => {
  const s = brief.summary;
  if (s.origin === "edited") return <Text dimColor>Edited by you.</Text>;
  if (s.origin === "llm") {
    return (
      <Para dimColor>
        Written by {s.model ?? "your LLM"}
        {s.cached ? " (cached)" : ""}. Check names and numbers before you paste.
      </Para>
    );
  }
  return s.note ? (
    <Notice kind="warn">
      <Text>Plain digest, no LLM: </Text>
      <Text>{s.note}</Text>
    </Notice>
  ) : (
    <Text dimColor>Plain digest of your activity, written without an LLM.</Text>
  );
};
export const Standup = ({ brief, label = "Standup" }: { brief: Brief; label?: string }) => (
  <Box flexDirection="column" marginTop={1}>
    <Label>{label}</Label>
    <Box marginTop={1} flexDirection="column">
      <Markdown text={brief.summary.text} />
    </Box>
    <Box marginTop={1}>
      <Provenance brief={brief} />
    </Box>
  </Box>
);
const Schedule = ({
  meetings,
  cal,
  now,
}: {
  meetings: readonly Activity[];
  cal: Calendar;
  now: Date;
}) => {
  if (meetings.length === 0) return <Empty>No meetings. A clear day for focus work.</Empty>;
  const allDay = meetings.filter((m) => m.metadata.allDay);
  const timed = meetings.filter((m) => !m.metadata.allDay);
  const t = now.getTime();
  const current = timed.find((m) => m.timestamp.getTime() <= t && m.end && m.end.getTime() > t);
  const next = current ? undefined : timed.find((m) => m.timestamp.getTime() > t);
  return (
    <Box flexDirection="column">
      {allDay.length > 0 && (
        <Para>
          <Text dimColor>All day </Text>
          {allDay.map((m) => m.title).join(" · ")}
        </Para>
      )}
      {timed.map((m) => {
        const past = (m.end ?? m.timestamp).getTime() <= t;
        const marker = m === current ? "NOW" : m === next ? "NEXT" : undefined;
        return (
          <Row
            key={m.id}
            leadWidth={13}
            lead={
              <Text dimColor>
                {formatTime(cal, m.timestamp)}
                {m.end ? `–${formatTime(cal, m.end)}` : ""}
              </Text>
            }
          >
            {marker ? <Text bold>{marker} </Text> : null}
            <Text dimColor={past}>{m.title}</Text>
            {m.end ? <Text dimColor> {span(minutes(m.timestamp, m.end))}</Text> : null}
          </Row>
        );
      })}
    </Box>
  );
};
const OpenStatus = ({ status }: { status: string }) =>
  status === "changes requested" || status.startsWith("blocked") ? (
    <Text color={tone("fail")}>! {status}</Text>
  ) : status === "approved" || status === "done" ? (
    <Text color={tone("ok")}>✓ {status}</Text>
  ) : (
    <Text dimColor>{status}</Text>
  );
const More = ({ hidden }: { hidden: number }) => {
  const keys = useContext(KeysLive);
  return hidden > 0 ? (
    <Text dimColor>{`… ${hidden} more${keys ? ", d shows all" : ""}`}</Text>
  ) : null;
};
const OpenList = ({
  items,
  empty,
  all,
}: {
  items: readonly OpenItem[];
  empty: string;
  all: boolean;
}) => {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  const shown = all ? items : items.slice(0, LIST_LIMIT);
  return (
    <Box flexDirection="column">
      {shown.map((i) => (
        <Box key={i.id}>
          <Box flexShrink={0} marginRight={1}>
            <Text dimColor>•</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Para>
              <Text dimColor>{i.ref}</Text> {i.title}
            </Para>
          </Box>
          {i.status ? (
            <Box flexShrink={0} marginLeft={2}>
              <OpenStatus status={i.status} />
            </Box>
          ) : null}
        </Box>
      ))}
      <More hidden={items.length - shown.length} />
    </Box>
  );
};
const Blockers = ({ blockers }: { blockers: readonly string[] }) =>
  blockers.length === 0 ? (
    <Empty>
      None found. Rundown flags your PRs with changes requested or waiting two days or more for
      review.
    </Empty>
  ) : (
    <Box flexDirection="column">
      {blockers.map((b) => (
        <Notice key={b} kind="fail">
          {b}
        </Notice>
      ))}
    </Box>
  );
const facts = (g: ProjectGroup) =>
  [
    g.prsMerged > 0 && `${g.prsMerged} merged`,
    g.prsOpened > 0 && `${g.prsOpened} opened`,
    g.prsReviewed > 0 && plural(g.prsReviewed, "review"),
    g.commits > 0 && plural(g.commits, "commit"),
    g.issues > 0 && plural(g.issues, "issue"),
    g.sessions > 0 && plural(g.sessions, "agent session"),
  ]
    .filter(Boolean)
    .join(", ");
const ActivityLine = ({ a, cal, showDay }: { a: Activity; cal: Calendar; showDay: boolean }) => {
  const m = a.metadata;
  const ref = typeof m.ref === "string" ? m.ref : "";
  const extra =
    a.type === "agent-session"
      ? `${String(m.agent)}${m.prompts ? `, ${plural(Number(m.prompts), "prompt")}` : ""}`
      : a.type === "pr-reviewed" && m.review
        ? String(m.review)
        : a.type === "commit" && typeof m.additions === "number"
          ? `+${m.additions} −${String(m.deletions ?? 0)}`
          : a.type === "meeting" && a.end
            ? span(minutes(a.timestamp, a.end))
            : "";
  const when = `${showDay ? `${formatDay(cal, a.timestamp).split(",")[0]} ` : ""}${formatTime(cal, a.timestamp)}`;
  return (
    <Row
      leadWidth={showDay ? 12 : 8}
      lead={
        <Text dimColor>
          {when} {GLYPH[a.type]}
        </Text>
      }
    >
      {ref ? <Text dimColor>{ref} </Text> : null}
      {a.title}
      {extra ? <Text dimColor> · {extra}</Text> : null}
    </Row>
  );
};
const Group = ({
  title,
  summary,
  diff,
  activities,
  cal,
  details,
  showDay,
}: {
  title: string;
  summary: string;
  diff?: string | undefined;
  activities: readonly Activity[];
  cal: Calendar;
  details: boolean;
  showDay: boolean;
}) => (
  <Box flexDirection="column">
    <Row
      lead={<Text bold>{title}</Text>}
      gap={2}
      trail={diff ? <Text dimColor>{diff}</Text> : undefined}
    >
      <Text dimColor>{summary}</Text>
    </Row>
    {details && (
      <Box flexDirection="column" paddingLeft={2}>
        {activities.map((a) => (
          <ActivityLine key={a.id} a={a} cal={cal} showDay={showDay} />
        ))}
      </Box>
    )}
  </Box>
);
const WeekChart = ({ days, spaced }: { days: readonly DayCount[]; spaced: boolean }) => {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <Box flexDirection="column" marginBottom={spaced ? 1 : 0}>
      {days.map((d) => (
        <Box key={d.key}>
          <Box width={5} flexShrink={0}>
            <Text dimColor>{d.label.split(",")[0]}</Text>
          </Box>
          <Text>{"█".repeat(Math.max(1, Math.round((d.count / max) * 20)))}</Text>
          <Text dimColor> {d.count}</Text>
        </Box>
      ))}
    </Box>
  );
};
const Receipts = ({
  activities,
  meetings,
  days,
  cal,
  details,
  showDay,
  empty,
}: {
  activities: readonly Activity[];
  meetings: readonly Activity[];
  days?: readonly DayCount[] | undefined;
  cal: Calendar;
  details: boolean;
  showDay: boolean;
  empty: string;
}) => {
  const keys = useContext(KeysLive);
  const groups = groupByProject(activities);
  if (groups.length === 0 && meetings.length === 0) return <Empty>{empty}</Empty>;
  const meetingMinutes = meetings.reduce(
    (n, m) => n + (m.end ? minutes(m.timestamp, m.end) : 0),
    0,
  );
  return (
    <Box flexDirection="column" gap={details ? 1 : 0}>
      {days && days.length > 1 ? <WeekChart days={days} spaced={!details} /> : null}
      {groups.map((g) => (
        <Group
          key={g.project}
          title={g.project}
          summary={facts(g)}
          diff={
            g.additions + g.deletions > 0
              ? `+${g.additions.toLocaleString()} −${g.deletions.toLocaleString()}`
              : undefined
          }
          activities={g.activities}
          cal={cal}
          details={details}
          showDay={showDay}
        />
      ))}
      {meetings.length > 0 && (
        <Group
          title="Meetings"
          summary={`${plural(meetings.length, "meeting")}${meetingMinutes ? `, ${span(meetingMinutes)}` : ""}`}
          activities={meetings}
          cal={cal}
          details={details}
          showDay={showDay}
        />
      )}
      {!details && keys && <Text dimColor>d shows every commit, PR and session</Text>}
    </Box>
  );
};
export const SourceFooter = ({
  reports,
  verbose,
}: {
  reports: readonly SourceReport[];
  verbose: boolean;
}) => {
  const ok = reports.filter((r) => r.status === "ok");
  const failed = reports.filter((r) => r.status === "failed");
  const items = ok.reduce((n, r) => n + r.count, 0);
  const keys = useContext(KeysLive);
  if (verbose) {
    return (
      <Section label="Sources" aside={`${ok.length} of ${reports.length} answered`}>
        {reports.map((r) => (
          <Box key={r.id} flexDirection="column">
            <Box>
              <Box width={18} flexShrink={0}>
                <Text wrap="truncate-end">{r.label}</Text>
              </Box>
              <Box width={10} flexShrink={0}>
                <StatusWord status={r.status} />
              </Box>
              <Box width={6} flexShrink={0} justifyContent="flex-end" marginRight={1}>
                <Text dimColor>{r.status === "ok" ? String(r.count) : ""}</Text>
              </Box>
              <Box width={7} flexShrink={0} justifyContent="flex-end" marginRight={2}>
                <Text dimColor>{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : ""}</Text>
              </Box>
              <Box flexShrink={1}>
                <Para dimColor>{r.detail}</Para>
              </Box>
            </Box>
            {r.hint ? (
              <Box paddingLeft={2}>
                <Para dimColor>↳ {r.hint}</Para>
              </Box>
            ) : null}
          </Box>
        ))}
      </Section>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Para dimColor>
        Built from {plural(items, "item")} across {ok.length} of {reports.length} sources.
        {keys ? " s lists them." : ""}
      </Para>
      {failed.map((r) => (
        <Box key={r.id} flexDirection="column">
          <Notice kind="fail">
            {r.label} failed: {r.detail}
          </Notice>
          {r.hint ? (
            <Box paddingLeft={2}>
              <Para dimColor>{r.hint}</Para>
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  );
};
export const windowLabel = (b: Brief) =>
  (b.kind === "today" ? b.plan?.window.label : b.recap?.window.label) ?? "";
export const Header = ({ brief }: { brief: Brief }) => (
  <Para>
    <Text bold>{TITLE[brief.kind]}</Text>
    <Text dimColor>
      {"  "}
      {windowLabel(brief)}
    </Text>
  </Para>
);
export const PlanSections = ({
  brief,
  cal,
  details,
  now,
}: {
  brief: Brief;
  cal: Calendar;
  details: boolean;
  now: Date;
}) => {
  const plan = brief.plan;
  if (!plan) return null;
  const count = (xs: readonly unknown[]) => (xs.length ? String(xs.length) : undefined);
  return (
    <>
      <Section label="Schedule" aside={plan.window.label}>
        <Schedule meetings={plan.meetings} cal={cal} now={now} />
      </Section>
      <Section label="To ship" aside={count(plan.authored)}>
        <OpenList items={plan.authored} empty="No open pull requests of yours." all={details} />
      </Section>
      <Section label="Reviews owed" aside={count(plan.reviews)}>
        <OpenList items={plan.reviews} empty="Nobody is waiting on your review." all={details} />
      </Section>
      {plan.issues.length > 0 && (
        <Section label="Issues" aside={count(plan.issues)}>
          <OpenList items={plan.issues} empty="" all={details} />
        </Section>
      )}
      <Section label="Blockers">
        <Blockers blockers={brief.blockers} />
      </Section>
    </>
  );
};
export const ReceiptSections = ({
  brief,
  cal,
  details,
}: {
  brief: Brief;
  cal: Calendar;
  details: boolean;
}) => {
  const { recap, plan } = brief;
  return (
    <>
      {brief.kind === "today" && plan && (
        <Section label="So far" aside="today">
          <Receipts
            activities={plan.sofar}
            meetings={[]}
            cal={cal}
            details={details}
            showDay={false}
            empty="Nothing logged yet today."
          />
        </Section>
      )}
      {recap && (
        <Section label="Receipts" aside={recap.window.label}>
          <Receipts
            activities={recap.activities}
            meetings={recap.meetings}
            days={recap.days}
            cal={cal}
            details={details}
            showDay={
              brief.kind === "week" ||
              recap.window.end.getTime() - recap.window.start.getTime() > 86400000
            }
            empty={`Nothing logged for ${recap.window.label}. No commits, pull requests or agent sessions turned up.`}
          />
        </Section>
      )}
      {!plan && brief.blockers.length > 0 && (
        <Section label="Blockers">
          <Blockers blockers={brief.blockers} />
        </Section>
      )}
    </>
  );
};
export const calendarFor = (brief: Brief) => makeCalendar(brief.user.timeZone, []);
export const BriefView = ({
  brief,
  view,
  width,
  now = new Date(),
}: {
  brief: Brief;
  view: ViewState;
  width?: number;
  now?: Date;
}) => {
  const cal = calendarFor(brief);
  return (
    <Box flexDirection="column" {...(width ? { width } : {})}>
      <Header brief={brief} />
      <Standup brief={brief} />
      <PlanSections brief={brief} cal={cal} details={view.details} now={now} />
      <ReceiptSections brief={brief} cal={cal} details={view.details} />
      <SourceFooter reports={brief.reports} verbose={view.sources} />
    </Box>
  );
};
