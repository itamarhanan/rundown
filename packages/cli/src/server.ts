import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  Aggregator,
  type BriefKind,
  BriefKinds,
  type BriefOptions,
  Briefs,
  Cache,
  RundownConfig,
  type SourceReport,
  Summarizer,
  dayWindow,
  formatDay,
  groupByProject,
  localParts,
  makeCalendar,
  nowDate,
  paths,
  sinceLastWorkday,
} from "@rundown/core";
import { Cause, Effect, Option } from "effect";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type AppServices, getRuntime } from "./runtime";
import { VERSION } from "./version";
export const webRoot = (): string | undefined => {
  const candidates = [
    process.env.RUNDOWN_WEB_DIR,
    fileURLToPath(new URL("../../web/dist", import.meta.url)),
    fileURLToPath(new URL("../web", import.meta.url)),
  ];
  return candidates.find(
    (c): c is string => Boolean(c) && fs.existsSync(path.join(c!, "index.html")),
  );
};
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DAY = 86400000;
interface Failure {
  readonly status: 400 | 500;
  readonly body: {
    readonly error: string;
    readonly hint?: string;
  };
}
const failureOf = (cause: Cause.Cause<unknown>): Failure => {
  const failure = Option.getOrUndefined(Cause.failureOption(cause)) as
    | {
        _tag?: string;
        message?: string;
        hint?: string;
      }
    | undefined;
  return {
    status: failure?._tag === "BriefError" ? 400 : 500,
    body: {
      error: failure?.message ?? Cause.pretty(cause),
      ...(failure?.hint ? { hint: failure.hint } : {}),
    },
  };
};
const respond = async <A>(effect: Effect.Effect<A, unknown, AppServices>) => {
  const exit = await getRuntime().runPromiseExit(effect);
  if (exit._tag === "Success") return { status: 200 as const, body: exit.value as unknown };
  return failureOf(exit.cause);
};
const briefOptions = (q: (name: string) => string | undefined): Omit<BriefOptions, "onReport"> => {
  const date = q("date");
  return {
    refresh: q("refresh") === "1",
    llm: q("llm") !== "0",
    ...(date ? { date } : {}),
    ...(q("last") === "1" ? { weekOffset: -1 } : {}),
  };
};
const clampDays = (raw: string | undefined) => Math.min(90, Math.max(1, Number(raw) || 30));
export const createApp = () => {
  const app = new Hono();
  let lastReports:
    | {
        at: string;
        reports: readonly SourceReport[];
      }
    | undefined;
  const remember = (reports: readonly SourceReport[]) => {
    lastReports = { at: new Date().toISOString(), reports };
  };
  app.use("*", async (c, next) => {
    const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) return c.json({ error: "forbidden host" }, 403);
    await next();
  });
  app.get("/api/meta", async (c) => {
    const r = await respond(
      Effect.gen(function* () {
        const cfg = yield* RundownConfig;
        const s = yield* Summarizer;
        return {
          version: VERSION,
          user: {
            name: cfg.user.name,
            timeZone: cfg.user.timezone,
            workdays: cfg.user.workdays,
          },
          llm: s.availability.ok
            ? { ok: true, model: s.availability.model }
            : { ok: false, reason: s.availability.reason },
          schedule: cfg.schedule,
          paths: { config: paths.config, data: paths.data },
        };
      }),
    );
    return c.json(r.body as object, r.status);
  });
  app.get("/api/brief/:kind", async (c) => {
    const kind = c.req.param("kind") as BriefKind;
    if (!BriefKinds.includes(kind)) return c.json({ error: `unknown brief "${kind}"` }, 404);
    const r = await respond(
      Effect.flatMap(Briefs, (b) =>
        b.build(
          kind,
          briefOptions((n) => c.req.query(n)),
        ),
      ),
    );
    if (r.status === 200)
      remember(
        (
          r.body as {
            reports: readonly SourceReport[];
          }
        ).reports,
      );
    return c.json(r.body as object, r.status);
  });
  app.get("/api/brief/:kind/stream", (c) => {
    const kind = c.req.param("kind") as BriefKind;
    if (!BriefKinds.includes(kind)) return c.json({ error: `unknown brief "${kind}"` }, 404);
    const opts = briefOptions((n) => c.req.query(n));
    return streamSSE(c, async (stream) => {
      const pending: Promise<unknown>[] = [];
      const exit = await getRuntime().runPromiseExit(
        Effect.flatMap(Briefs, (b) =>
          b.build(kind, {
            ...opts,
            onReport: (r) =>
              void pending.push(stream.writeSSE({ event: "report", data: JSON.stringify(r) })),
          }),
        ),
      );
      await Promise.all(pending);
      if (exit._tag === "Success") {
        remember(exit.value.reports);
        await stream.writeSSE({
          event: "brief",
          data: JSON.stringify(exit.value),
        });
      } else {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify(failureOf(exit.cause).body),
        });
      }
    });
  });
  app.put("/api/brief/edit", async (c) => {
    const body = await c.req
      .json<{
        key?: string;
        text?: string;
      }>()
      .catch(
        () =>
          ({}) as {
            key?: string;
            text?: string;
          },
      );
    if (!body.key || typeof body.text !== "string")
      return c.json({ error: "expected { key, text }" }, 400);
    const r = await respond(Effect.flatMap(Briefs, (b) => b.saveEdit(body.key!, body.text!)));
    return c.json(r.status === 200 ? { ok: true } : (r.body as object), r.status);
  });
  app.delete("/api/brief/edit", async (c) => {
    const key = c.req.query("key");
    if (!key) return c.json({ error: "expected ?key=" }, 400);
    const r = await respond(Effect.flatMap(Briefs, (b) => b.clearEdit(key)));
    return c.json(r.status === 200 ? { ok: true } : (r.body as object), r.status);
  });
  app.get("/api/sources", async (c) => {
    const r = await respond(Effect.flatMap(Aggregator, (a) => a.detectAll));
    if (r.status !== 200) return c.json(r.body as object, r.status);
    return c.json({ sources: r.body, last: lastReports ?? null });
  });
  app.post("/api/sources/test", async (c) => {
    const r = await respond(
      Effect.gen(function* () {
        const cfg = yield* RundownConfig;
        const cal = makeCalendar(cfg.user.timezone, cfg.user.workdays);
        const now = yield* nowDate;
        const window = {
          start: sinceLastWorkday(cal, now).start,
          end: dayWindow(cal, now).end,
        };
        const collected = yield* Effect.flatMap(Aggregator, (a) =>
          a.collect(window, { open: true }),
        );
        return {
          reports: collected.reports,
          activities: collected.activities.length,
          open: collected.open.length,
        };
      }),
    );
    if (r.status === 200)
      remember(
        (
          r.body as {
            reports: readonly SourceReport[];
          }
        ).reports,
      );
    return c.json(r.body as object, r.status);
  });
  app.get("/api/history", async (c) => {
    const days = clampDays(c.req.query("days"));
    const r = await respond(
      Effect.gen(function* () {
        const cfg = yield* RundownConfig;
        const cal = makeCalendar(cfg.user.timezone, cfg.user.workdays);
        const now = yield* nowDate;
        const end = dayWindow(cal, now).end;
        const start = dayWindow(cal, new Date(end.getTime() - days * DAY)).start;
        const cache = yield* Cache;
        const activities = yield* cache.activities({ start, end });
        const byDay = new Map<string, typeof activities>();
        for (const a of activities) {
          const p = localParts(cal, a.timestamp);
          const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
          byDay.set(key, [...(byDay.get(key) ?? []), a]);
        }
        return [...byDay.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([key, acts]) => ({
            key,
            label: formatDay(cal, acts[0]!.timestamp),
            count: acts.length,
            meetings: acts.filter((a) => a.type === "meeting").length,
            projects: groupByProject(acts)
              .slice(0, 4)
              .map((g) => ({ project: g.project, count: g.activities.length })),
          }));
      }),
    );
    return c.json(r.body as object, r.status);
  });
  app.post("/api/history/collect", async (c) => {
    const days = clampDays(c.req.query("days"));
    const r = await respond(
      Effect.gen(function* () {
        const cfg = yield* RundownConfig;
        const cal = makeCalendar(cfg.user.timezone, cfg.user.workdays);
        const now = yield* nowDate;
        const end = dayWindow(cal, now).end;
        const start = dayWindow(cal, new Date(end.getTime() - days * DAY)).start;
        const collected = yield* Effect.flatMap(Aggregator, (a) => a.collect({ start, end }));
        const cache = yield* Cache;
        yield* cache.saveActivities(collected.activities);
        return {
          activities: collected.activities.length,
          reports: collected.reports,
        };
      }),
    );
    if (r.status === 200)
      remember(
        (
          r.body as {
            reports: readonly SourceReport[];
          }
        ).reports,
      );
    return c.json(r.body as object, r.status);
  });
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
  const root = webRoot();
  if (root) {
    app.use("/*", serveStatic({ root: path.relative(process.cwd(), root) }));
    const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
    app.get("*", (c) => c.html(index));
  } else {
    app.get("*", (c) =>
      c.text(
        "The web UI isn't built. Run `pnpm build` in the rundown repo, then restart `rundown serve`.",
        503,
      ),
    );
  }
  return app;
};
export const startServer = (port: number) =>
  new Promise<{
    url: string;
    close: () => void;
  }>((resolve, reject) => {
    const server = serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" }, (info) =>
      resolve({
        url: `http://localhost:${info.port}`,
        close: () => server.close(),
      }),
    );
    server.on("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "EADDRINUSE" ? new Error(`port ${port} is in use; try --port`) : e),
    );
  });
