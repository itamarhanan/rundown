import { DateTime } from "effect";
import type { DateWindow } from "../../domain/activity";
export interface Attendee {
  readonly email: string;
  readonly status?: string;
}
export interface CalendarEvent {
  readonly uid: string;
  readonly summary: string;
  readonly start: Date;
  readonly end: Date;
  readonly allDay: boolean;
  readonly location?: string;
  readonly description?: string;
  readonly meetingUrl?: string;
  readonly organizer?: string;
  readonly attendees: readonly Attendee[];
  readonly recurring: boolean;
}
interface Prop {
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
  readonly value: string;
}
interface Wall {
  readonly y: number;
  readonly m: number;
  readonly d: number;
  readonly h: number;
  readonly mi: number;
  readonly s: number;
}
interface When {
  readonly at: Date;
  readonly wall: Wall;
  readonly allDay: boolean;
  readonly zone: string;
}
interface RawEvent {
  readonly props: readonly Prop[];
}
const unfold = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
const parseProp = (line: string): Prop | undefined => {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return undefined;
  const [name = "", ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
};
const unescapeText = (s: string) =>
  s
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
const lexEvents = (text: string): RawEvent[] => {
  const events: RawEvent[] = [];
  let current: Prop[] | undefined;
  let depth = 0;
  for (const line of unfold(text).split("\n")) {
    if (line === "BEGIN:VEVENT") {
      current = [];
      depth = 0;
    } else if (line === "END:VEVENT") {
      if (current) events.push({ props: current });
      current = undefined;
    } else if (current) {
      if (line.startsWith("BEGIN:")) depth++;
      else if (line.startsWith("END:")) depth--;
      else if (depth === 0) {
        const p = parseProp(line);
        if (p) current.push(p);
      }
    }
  }
  return events;
};
const WINDOWS_ZONES: Record<string, string> = {
  "Israel Standard Time": "Asia/Jerusalem",
  "Jerusalem Standard Time": "Asia/Jerusalem",
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "Russian Standard Time": "Europe/Moscow",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
  UTC: "UTC",
  "Coordinated Universal Time": "UTC",
};
const validZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const resolveZone = (tzid: string | undefined, fallback: string): string => {
  if (!tzid) return fallback;
  if (validZone(tzid)) return tzid;
  const mapped = WINDOWS_ZONES[tzid];
  if (mapped) return mapped;
  const tail = /([A-Za-z_]+\/[A-Za-z_+-]+)$/.exec(tzid)?.[1];
  return tail && validZone(tail) ? tail : fallback;
};
const toInstant = (w: Wall, zone: string): Date => {
  if (zone === "UTC") return new Date(Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s));
  const dt = DateTime.unsafeMakeZoned(
    { year: w.y, month: w.m, day: w.d, hours: w.h, minutes: w.mi, seconds: w.s },
    { timeZone: zone, adjustForTimeZone: true },
  );
  return DateTime.toDateUtc(dt);
};
const parseWhen = (prop: Prop, fallbackZone: string): When | undefined => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!m) return undefined;
  const allDay = prop.params.VALUE === "DATE" || m[4] === undefined;
  const wall: Wall = {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    h: allDay ? 0 : Number(m[4]),
    mi: allDay ? 0 : Number(m[5]),
    s: allDay ? 0 : Number(m[6] ?? 0),
  };
  const zone = m[7] ? "UTC" : resolveZone(prop.params.TZID, fallbackZone);
  return { at: toInstant(wall, zone), wall, allDay, zone };
};
const parseDuration = (s: string): number | undefined => {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    s.trim(),
  );
  if (!m) return undefined;
  const [, sign, w, d, h, mi, sec] = m;
  const ms =
    ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 86400 +
      Number(h ?? 0) * 3600 +
      Number(mi ?? 0) * 60 +
      Number(sec ?? 0)) *
    1000;
  return sign === "-" ? -ms : ms;
};
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DAY_MS = 86400000;
const cdate = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const cparts = (t: number) => {
  const x = new Date(t);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), wd: x.getUTCDay() };
};
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
interface Rule {
  readonly freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  readonly interval: number;
  readonly count?: number;
  readonly until?: Date;
  readonly byDay: readonly {
    readonly wd: number;
    readonly nth?: number;
  }[];
  readonly byMonthDay: readonly number[];
  readonly byMonth: readonly number[];
  readonly wkst: number;
}
const parseRule = (value: string, zone: string): Rule | undefined => {
  const parts = Object.fromEntries(
    value.split(";").map((kv) => {
      const [k = "", v = ""] = kv.split("=");
      return [k.toUpperCase(), v];
    }),
  );
  const freq = parts.FREQ as Rule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return undefined;
  const untilProp = parts.UNTIL
    ? parseWhen({ name: "UNTIL", params: {}, value: parts.UNTIL }, zone)
    : undefined;
  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL ?? 1)),
    ...(parts.COUNT ? { count: Number(parts.COUNT) } : {}),
    ...(untilProp
      ? { until: new Date(untilProp.at.getTime() + (untilProp.allDay ? DAY_MS - 1 : 0)) }
      : {}),
    byDay: (parts.BYDAY ? parts.BYDAY.split(",") : []).flatMap((tok: string) => {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(tok.trim());
      if (!m) return [];
      const wd = DAYS.indexOf(m[2] as (typeof DAYS)[number]);
      return [m[1] ? { wd, nth: Number(m[1]) } : { wd }];
    }),
    byMonthDay: parts.BYMONTHDAY ? parts.BYMONTHDAY.split(",").map(Number) : [],
    byMonth: parts.BYMONTH ? parts.BYMONTH.split(",").map(Number) : [],
    wkst: parts.WKST ? Math.max(0, DAYS.indexOf(parts.WKST as (typeof DAYS)[number])) : 1,
  };
};
const daysInPeriod = (
  rule: Rule,
  periodStart: number,
  dtstart: ReturnType<typeof cparts>,
): number[] => {
  const p = cparts(periodStart);
  switch (rule.freq) {
    case "DAILY":
      return rule.byDay.length === 0 || rule.byDay.some((b) => b.wd === p.wd) ? [periodStart] : [];
    case "WEEKLY": {
      const wds = rule.byDay.length ? rule.byDay.map((b) => b.wd) : [dtstart.wd];
      return [0, 1, 2, 3, 4, 5, 6]
        .map((i) => periodStart + i * DAY_MS)
        .filter((t) => wds.includes(cparts(t).wd));
    }
    case "MONTHLY":
    case "YEARLY": {
      const months =
        rule.freq === "YEARLY" ? (rule.byMonth.length ? rule.byMonth : [dtstart.m]) : [p.m];
      return months.flatMap((m) => {
        if (rule.freq === "MONTHLY" && rule.byMonth.length && !rule.byMonth.includes(m)) return [];
        const dim = daysInMonth(p.y, m);
        if (rule.byDay.length) {
          return rule.byDay.flatMap(({ wd, nth }) => {
            const all = Array.from({ length: dim }, (_, i) => cdate(p.y, m, i + 1)).filter(
              (t) => cparts(t).wd === wd,
            );
            if (nth === undefined) return all;
            const pick = nth > 0 ? all[nth - 1] : all[all.length + nth];
            return pick === undefined ? [] : [pick];
          });
        }
        const mdays = rule.byMonthDay.length ? rule.byMonthDay : [dtstart.d];
        return mdays.flatMap((md) => {
          const day = md > 0 ? md : dim + md + 1;
          return day >= 1 && day <= dim ? [cdate(p.y, m, day)] : [];
        });
      });
    }
  }
};
const nextPeriod = (rule: Rule, t: number): number => {
  const p = cparts(t);
  switch (rule.freq) {
    case "DAILY":
      return t + rule.interval * DAY_MS;
    case "WEEKLY":
      return t + rule.interval * 7 * DAY_MS;
    case "MONTHLY":
      return cdate(p.y, p.m + rule.interval, 1);
    case "YEARLY":
      return cdate(p.y + rule.interval, 1, 1);
  }
};
const firstPeriod = (rule: Rule, start: ReturnType<typeof cparts>): number => {
  const day = cdate(start.y, start.m, start.d);
  switch (rule.freq) {
    case "DAILY":
      return day;
    case "WEEKLY":
      return day - ((start.wd - rule.wkst + 7) % 7) * DAY_MS;
    case "MONTHLY":
      return cdate(start.y, start.m, 1);
    case "YEARLY":
      return cdate(start.y, 1, 1);
  }
};
const expandRule = (rule: Rule, start: When, horizon: Date): Date[] => {
  const out: Date[] = [];
  const s = cparts(cdate(start.wall.y, start.wall.m, start.wall.d));
  const startDay = cdate(s.y, s.m, s.d);
  let emitted = 0;
  let period = firstPeriod(rule, s);
  for (let guard = 0; guard < 20000; guard++) {
    for (const day of daysInPeriod(rule, period, s).sort((a, b) => a - b)) {
      if (day < startDay) continue;
      const d = cparts(day);
      const at = toInstant({ ...start.wall, y: d.y, m: d.m, d: d.d }, start.zone);
      if (rule.until && at > rule.until) return out;
      if (rule.count !== undefined && emitted >= rule.count) return out;
      if (at > horizon) return out;
      emitted++;
      out.push(at);
    }
    period = nextPeriod(rule, period);
  }
  return out;
};
const MEETING_URL =
  /https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[\w.-]*zoom\.us\/[jw]\/[^\s<>"]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"]+|[\w.-]*webex\.com\/[^\s<>"]+|app\.around\.co\/[^\s<>"]+)/i;
export interface ParseOptions {
  readonly timeZone: string;
  readonly email?: string;
  readonly hideDeclined?: boolean;
}
export const eventsInWindow = (
  text: string,
  window: DateWindow,
  opts: ParseOptions,
): CalendarEvent[] => {
  const raws = lexEvents(text);
  const me = opts.email?.toLowerCase();
  const overridden = new Map<string, Set<number>>();
  for (const r of raws) {
    const uid = r.props.find((p) => p.name === "UID")?.value;
    const rid = r.props.find((p) => p.name === "RECURRENCE-ID");
    const when = rid && parseWhen(rid, opts.timeZone);
    if (uid && when) {
      const set = overridden.get(uid) ?? new Set();
      set.add(when.at.getTime());
      overridden.set(uid, set);
    }
  }
  const out: CalendarEvent[] = [];
  for (const r of raws) {
    const get = (name: string) => r.props.find((p) => p.name === name);
    const all = (name: string) => r.props.filter((p) => p.name === name);
    if (get("STATUS")?.value.toUpperCase() === "CANCELLED") continue;
    const dtstart = get("DTSTART");
    const start = dtstart && parseWhen(dtstart, opts.timeZone);
    if (!start) continue;
    const attendees: Attendee[] = all("ATTENDEE").map((p) => ({
      email: p.value.replace(/^mailto:/i, "").toLowerCase(),
      ...(p.params.PARTSTAT ? { status: p.params.PARTSTAT.toUpperCase() } : {}),
    }));
    if (
      opts.hideDeclined !== false &&
      me &&
      attendees.some((a) => a.email === me && a.status === "DECLINED")
    ) {
      continue;
    }
    const dtend = get("DTEND");
    const endWhen = dtend && parseWhen(dtend, opts.timeZone);
    const dur = get("DURATION");
    const length = endWhen
      ? endWhen.at.getTime() - start.at.getTime()
      : dur
        ? (parseDuration(dur.value) ?? 0)
        : start.allDay
          ? DAY_MS
          : 0;
    const uid = get("UID")?.value ?? `${start.at.toISOString()}:${get("SUMMARY")?.value ?? ""}`;
    const rrule = get("RRULE");
    const rule = rrule && !get("RECURRENCE-ID") ? parseRule(rrule.value, start.zone) : undefined;
    let starts: Date[];
    if (rule) {
      const excluded = new Set<number>(overridden.get(uid));
      for (const ex of all("EXDATE")) {
        for (const v of ex.value.split(",")) {
          const w = parseWhen({ ...ex, value: v }, start.zone);
          if (w) excluded.add(w.at.getTime());
        }
      }
      const rdates = all("RDATE").flatMap((p) =>
        p.value.split(",").flatMap((v) => {
          const w = parseWhen({ ...p, value: v }, start.zone);
          return w ? [w.at] : [];
        }),
      );
      starts = [...expandRule(rule, start, window.end), ...rdates].filter(
        (d) => !excluded.has(d.getTime()),
      );
    } else {
      starts = [start.at];
    }
    const description = get("DESCRIPTION") && unescapeText(get("DESCRIPTION")!.value);
    const location = get("LOCATION") && unescapeText(get("LOCATION")!.value);
    const conference = get("X-GOOGLE-CONFERENCE")?.value ?? get("URL")?.value;
    const meetingUrl =
      (conference && MEETING_URL.test(conference) ? conference : undefined) ??
      MEETING_URL.exec(`${location ?? ""} ${description ?? ""}`)?.[0];
    const organizer = get("ORGANIZER")?.value.replace(/^mailto:/i, "");
    for (const s of starts) {
      const end = new Date(s.getTime() + length);
      const overlaps =
        s < window.end && (end > window.start || (length === 0 && s >= window.start));
      if (!overlaps) continue;
      out.push({
        uid,
        summary: unescapeText(get("SUMMARY")?.value ?? "") || "(no title)",
        start: s,
        end,
        allDay: start.allDay,
        attendees,
        recurring: Boolean(rule) || Boolean(get("RECURRENCE-ID")),
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        ...(meetingUrl ? { meetingUrl } : {}),
        ...(organizer ? { organizer } : {}),
      });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
};
