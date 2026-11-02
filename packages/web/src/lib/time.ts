const cache = new Map<string, Intl.DateTimeFormat>();
const formatter = (timeZone: string, opts: Intl.DateTimeFormatOptions, locale = "en-US") => {
  const id = `${locale}|${timeZone}|${JSON.stringify(opts)}`;
  let f = cache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone });
    cache.set(id, f);
  }
  return f;
};
const toDate = (d: string | Date) => (typeof d === "string" ? new Date(d) : d);
export const formatTime = (d: string | Date, timeZone: string) =>
  formatter(timeZone, { hour: "numeric", minute: "2-digit" }).format(toDate(d));
export const formatDay = (d: string | Date, timeZone: string) =>
  formatter(timeZone, { weekday: "short", month: "short", day: "numeric" }).format(toDate(d));
export const formatLongDate = (d: string | Date, timeZone: string) =>
  formatter(timeZone, { weekday: "long", month: "long", day: "numeric" }).format(toDate(d));
export const formatDayTime = (d: string | Date, timeZone: string) =>
  formatter(timeZone, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(toDate(d));
export const dayKey = (d: string | Date, timeZone: string) =>
  formatter(timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA").format(
    toDate(d),
  );
export const sameDay = (a: string | Date, b: string | Date, timeZone: string) =>
  dayKey(a, timeZone) === dayKey(b, timeZone);
export const hourIn = (d: string | Date, timeZone: string) =>
  Number(formatter(timeZone, { hour: "numeric", hourCycle: "h23" }).format(toDate(d)));
export const greeting = (timeZone: string, now = new Date()) => {
  const h = hourIn(now, timeZone);
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
};
export const formatDuration = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return `${Math.round(ms / 60000)}m`;
};
export const formatMinutes = (total: number) => {
  const mins = Math.round(total);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};
export const formatSpan = (start: string, end: string) =>
  formatMinutes((new Date(end).getTime() - new Date(start).getTime()) / 60000);
export const relativeTime = (d: string | Date, now = new Date()) => {
  const secs = Math.round((toDate(d).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(secs);
  if (abs < 60) return rtf.format(secs, "second");
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  return rtf.format(Math.round(secs / 86400), "day");
};
export const shiftDay = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const keyLabel = (key: string) =>
  formatter("UTC", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${key}T12:00:00Z`),
  );
