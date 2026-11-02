import { DateTime, Effect } from "effect";
import type { DateWindow } from "./activity";
export interface Calendar {
  readonly timeZone: DateTime.TimeZone;
  readonly workdays: ReadonlySet<number>;
}
export const makeCalendar = (timeZone: string, workdays: readonly number[]): Calendar => ({
  timeZone: DateTime.zoneUnsafeMakeNamed(timeZone),
  workdays: new Set(workdays),
});
export interface LabeledWindow extends DateWindow {
  readonly label: string;
  readonly key: string;
}
const zoned = (cal: Calendar, at: Date | DateTime.DateTime) =>
  DateTime.unsafeMakeZoned(at, { timeZone: cal.timeZone });
const startOfDay = (cal: Calendar, at: Date | DateTime.DateTime) =>
  DateTime.startOf(zoned(cal, at), "day");
const weekday = (dt: DateTime.Zoned) => DateTime.toParts(dt).weekDay;
const fmt = (cal: Calendar, d: DateTime.Zoned, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", {
    ...opts,
    timeZone: DateTime.zoneToString(cal.timeZone),
  }).format(DateTime.toDateUtc(d));
const dayLabel = (cal: Calendar, d: DateTime.Zoned) =>
  fmt(cal, d, { weekday: "short", month: "short", day: "numeric" });
const window = (start: DateTime.Zoned, end: DateTime.Zoned, label: string): LabeledWindow => ({
  start: DateTime.toDateUtc(start),
  end: DateTime.toDateUtc(end),
  label,
  key: DateTime.formatIsoDate(start),
});
export const dayWindow = (cal: Calendar, at: Date): LabeledWindow => {
  const start = startOfDay(cal, at);
  return window(start, DateTime.add(start, { days: 1 }), dayLabel(cal, start));
};
export const parseLocalDate = (cal: Calendar, iso: string): Date | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const dt = DateTime.makeZoned(
    { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hours: 12 },
    { timeZone: cal.timeZone, adjustForTimeZone: true },
  );
  return dt._tag === "Some" ? DateTime.toDateUtc(dt.value) : undefined;
};
export const previousWorkday = (cal: Calendar, now: Date): DateTime.Zoned => {
  const today = startOfDay(cal, now);
  for (let back = 1; back <= 7; back++) {
    const d = DateTime.subtract(today, { days: back });
    if (cal.workdays.has(weekday(d))) return d;
  }
  return DateTime.subtract(today, { days: 1 });
};
export const sinceLastWorkday = (cal: Calendar, now: Date): LabeledWindow => {
  const start = previousWorkday(cal, now);
  const end = startOfDay(cal, now);
  const days = Math.round((end.epochMillis - start.epochMillis) / 86400000);
  const label = days <= 1 ? dayLabel(cal, start) : `${dayLabel(cal, start)} → today`;
  return window(start, end, label);
};
export const weekWindow = (cal: Calendar, now: Date, offset = 0): LabeledWindow => {
  const today = startOfDay(cal, now);
  const first = firstWorkdayOfWeek(cal);
  const back = (weekday(today) - first + 7) % 7;
  const start = DateTime.add(DateTime.subtract(today, { days: back }), {
    weeks: offset,
  });
  const end = offset === 0 ? DateTime.add(today, { days: 1 }) : DateTime.add(start, { weeks: 1 });
  const last = DateTime.subtract(end, { days: 1 });
  const label = `${fmt(cal, start, { month: "short", day: "numeric" })} – ${fmt(cal, last, { month: "short", day: "numeric" })}`;
  return window(start, end, label);
};
const firstWorkdayOfWeek = (cal: Calendar): number => {
  const days = [...cal.workdays].sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return 1;
  for (const d of days) if (!cal.workdays.has((d + 6) % 7)) return d;
  return days[0]!;
};
export const isWorkday = (cal: Calendar, at: Date): boolean =>
  cal.workdays.has(weekday(zoned(cal, at)));
export const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc);
export const formatTime = (cal: Calendar, at: Date): string =>
  fmt(cal, zoned(cal, at), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
export const formatDay = (cal: Calendar, at: Date): string => dayLabel(cal, zoned(cal, at));
export const localParts = (cal: Calendar, at: Date) => DateTime.toParts(zoned(cal, at));
