import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";
import * as fsp from "node:fs/promises";
import type { Activity, DateWindow } from "../../domain/activity";
import { SourceError, describeCause } from "../../errors";
import { exists } from "../../util/fs";
import { type Source, detected, notDetected } from "../source";
import { eventsInWindow } from "./ics";
export interface CalendarSourceOptions {
  readonly feeds: readonly string[];
  readonly timeZone: string;
  readonly email?: string;
  readonly hideDeclined?: boolean;
}
const isUrl = (s: string) => /^(https?|webcal):\/\//i.test(s);
export const redactFeed = (feed: string): string => {
  if (!isUrl(feed)) return feed;
  const m = /^[a-z]+:\/\/([^/?#]+)([^?#]*)/i.exec(feed.replace(/^webcal:/i, "https:"));
  if (!m) return "https://…";
  const host = m[1]!.replace(/^[^@]*@/, "");
  const last = m[2]!.split("/").filter(Boolean).pop();
  const file = last && /^[a-z][\w-]{0,15}\.ics$/i.test(last) ? last : undefined;
  return m[2]!.replace(/\/+$/, "")
    ? `https://${host}/…${file ? `/${file}` : ""}`
    : `https://${host}`;
};
const CONFIG_KEY = "sources.calendar.ics";
const EDIT = "run `rundown config --edit`";
const STATUS_TEXT: Record<number, string> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not found",
  410: "gone",
};
export const feedFailure = (
  feed: string,
  failure: {
    readonly status?: number;
    readonly message?: string;
  },
) => {
  const shown = redactFeed(feed);
  const { status } = failure;
  if (status !== undefined) {
    const label = STATUS_TEXT[status] ? ` (${STATUS_TEXT[status]})` : "";
    const message = `calendar URL ${shown} returned HTTP ${status}${label}`;
    if (status === 404 || status === 410) {
      return {
        message,
        hint: `The ICS URL in ${CONFIG_KEY} is wrong, or its secret address was reset. Copy the calendar's secret iCal address again and update ${CONFIG_KEY}: ${EDIT}.`,
      };
    }
    if (status === 401 || status === 403) {
      return {
        message,
        hint: `The calendar refused the ICS URL: it may have been reset or sharing turned off. Copy the secret iCal address again into ${CONFIG_KEY}: ${EDIT}.`,
      };
    }
    return {
      message,
      ...(status >= 500 ? { hint: "The calendar server had a problem; try again later." } : {}),
    };
  }
  const raw = feed.replace(/^webcal:/i, "https:");
  const detail = (failure.message ?? "request failed")
    .split(raw)
    .join(shown)
    .split(feed)
    .join(shown);
  return {
    message: `couldn't reach calendar URL ${shown}: ${detail}`,
    hint: `Check your network, and that the URL in ${CONFIG_KEY} is right: ${EDIT}.`,
  };
};
export const makeCalendarSource = (opts: CalendarSourceOptions) =>
  Effect.gen(function* () {
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const read = (feed: string) =>
      isUrl(feed)
        ? http.execute(HttpClientRequest.get(feed.replace(/^webcal:/i, "https:"))).pipe(
            Effect.flatMap((r) => r.text),
            Effect.scoped,
            Effect.mapError((e) => {
              const status = e._tag === "ResponseError" ? e.response.status : undefined;
              return new SourceError({
                source: "calendar",
                ...feedFailure(feed, status !== undefined ? { status } : { message: e.message }),
              });
            }),
          )
        : Effect.tryPromise({
            try: () => fsp.readFile(feed, "utf8"),
            catch: (e) =>
              new SourceError({
                source: "calendar",
                message: `calendar file ${feed}: ${describeCause(e)}`,
                hint: `Check the path in ${CONFIG_KEY}: ${EDIT}.`,
                cause: e,
              }),
          });
    const activities = (window: DateWindow) =>
      Effect.gen(function* () {
        const texts = yield* Effect.forEach(opts.feeds, (f) => Effect.either(read(f)), {
          concurrency: 4,
        });
        const ok = texts.flatMap((t) => (t._tag === "Right" ? [t.right] : []));
        const failed = texts.flatMap((t) => (t._tag === "Left" ? [t.left] : []));
        if (ok.length === 0 && failed.length > 0) return yield* failed[0]!;
        const seen = new Set<string>();
        const out: Activity[] = [];
        for (const text of ok) {
          for (const ev of eventsInWindow(text, window, opts)) {
            const id = `calendar:${ev.uid}:${ev.start.toISOString()}`;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({
              id,
              source: "calendar",
              type: "meeting",
              timestamp: ev.start,
              end: ev.end,
              title: ev.summary,
              ...(ev.location ? { description: ev.location } : {}),
              ...(ev.meetingUrl ? { url: ev.meetingUrl } : {}),
              metadata: {
                allDay: ev.allDay,
                recurring: ev.recurring,
                attendees: ev.attendees.length,
                ...(ev.organizer ? { organizer: ev.organizer } : {}),
              },
            });
          }
        }
        return out;
      });
    return {
      id: "calendar",
      label: "Calendar",
      detect: Effect.sync(() => {
        if (opts.feeds.length === 0) return notDetected("no ICS feeds (sources.calendar.ics)");
        const missing = opts.feeds.filter((f) => !isUrl(f) && !exists(f));
        return missing.length === opts.feeds.length
          ? notDetected(`file not found: ${missing.join(", ")}`)
          : detected(`${opts.feeds.length} feed${opts.feeds.length > 1 ? "s" : ""}`);
      }),
      activities,
    } satisfies Source;
  });
