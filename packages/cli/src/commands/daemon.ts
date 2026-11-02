import * as p from "@clack/prompts";
import {
  type Brief,
  Briefs,
  type Calendar,
  type Config,
  formatDay,
  formatTime,
  isWorkday,
  localParts,
  makeCalendar,
  type Notification,
  Notifier,
  paths,
  providerEnvKey,
  RundownConfig,
} from "@rundown/core";
import { defineCommand } from "citty";
import { Effect } from "effect";
import cron from "node-cron";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import { disposeRuntime, reportFailure, run, runPromise } from "../runtime";
import { isInteractive, openTerminal, openUrl } from "../util/system";
const home = os.homedir();
const tilde = (s: string) => (s.startsWith(home) ? `~${s.slice(home.length)}` : s);
export const cronExpression = (cfg: Pick<Config, "schedule" | "user">): string => {
  const [h, m] = cfg.schedule.morningBrief.split(":").map(Number) as [number, number];
  const days = [...new Set(cfg.user.workdays)].sort((a, b) => a - b);
  return `${m} ${h} * * ${days.length ? days.join(",") : "*"}`;
};
export const localDateKey = (cal: Calendar, at: Date): string => {
  const p = localParts(cal, at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};
export const missedToday = (
  cfg: Pick<Config, "schedule">,
  cal: Calendar,
  now: Date,
  lastFired?: string,
): boolean => {
  const workday = cal.workdays.size === 0 || isWorkday(cal, now);
  if (!workday || lastFired === localDateKey(cal, now)) return false;
  const [h, m] = cfg.schedule.morningBrief.split(":").map(Number) as [number, number];
  const p = localParts(cal, now);
  return p.hours * 60 + p.minutes >= h * 60 + m;
};
export interface SchedulerDeps {
  readonly cfg: Pick<Config, "schedule" | "user">;
  readonly fire: () => Promise<void>;
  readonly readLastFired: () => string | undefined;
  readonly writeLastFired: (day: string) => void;
  readonly log: (msg: string) => void;
  readonly checkEveryMs?: number;
}
export interface Scheduler {
  readonly nextRun: () => Date | null;
  readonly stop: () => Promise<void>;
}
export const startScheduler = (deps: SchedulerDeps): Scheduler => {
  const { cfg } = deps;
  const cal = makeCalendar(cfg.user.timezone, cfg.user.workdays);
  let running = false;
  const attempt = async (reason: "scheduled" | "catch-up") => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const today = localDateKey(cal, now);
      if (deps.readLastFired() === today) return;
      if (reason === "catch-up") {
        if (!missedToday(cfg, cal, now, deps.readLastFired())) return;
        deps.log(`missed today's ${cfg.schedule.morningBrief} brief; delivering it now`);
      }
      deps.writeLastFired(today);
      await deps.fire();
      const next = task.getNextRun();
      if (next) deps.log(`next brief ${when(cal, cfg.user.timezone, next)}`);
    } catch (e) {
      deps.log(
        `scheduler error: ${
          (
            e as {
              message?: string;
            }
          ).message ?? String(e)
        }`,
      );
    } finally {
      running = false;
    }
  };
  const task = cron.schedule(cronExpression(cfg), () => attempt("scheduled"), {
    timezone: cfg.user.timezone,
    name: "rundown-morning-brief",
    noOverlap: true,
  });
  task.on("execution:missed", () => void attempt("catch-up"));
  const timer = setInterval(() => void attempt("catch-up"), deps.checkEveryMs ?? 60000);
  const first = setTimeout(() => void attempt("catch-up"), 0);
  return {
    nextRun: () => task.getNextRun(),
    stop: async () => {
      clearTimeout(first);
      clearInterval(timer);
      await task.destroy();
    },
  };
};
const nextRun = (cfg: Config): Date | undefined => {
  const task = cron.createTask(cronExpression(cfg), () => {}, {
    timezone: cfg.user.timezone,
  });
  const next = task.getNextRuns(1)[0];
  void task.destroy();
  return next;
};
const when = (cal: Calendar, tz: string, at: Date) => {
  const mins = Math.max(0, Math.round((at.getTime() - Date.now()) / 60000));
  const rel = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  return `${formatDay(cal, at)} ${formatTime(cal, at)} ${tz} (in ${rel})`;
};
interface State {
  readonly lastFired?: string;
}
const stateFile = () => path.join(paths.data, "daemon.json");
const readState = (): State => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as State;
  } catch {
    return {};
  }
};
const writeState = (s: State) => {
  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(stateFile(), `${JSON.stringify(s, null, 2)}\n`);
};
const BULLET = /^[-*+]\s+/;
export const preview = (markdown: string, max = 4): string => {
  const plain = (s: string) =>
    s
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*|__|`/g, "")
      .replace(/^#+\s*/, "")
      .trim();
  const lines = markdown.split("\n");
  const bullets = lines.filter((l) => BULLET.test(l)).map((l) => plain(l.replace(BULLET, "")));
  const picked = (
    bullets.length ? bullets.filter((b) => b !== "None").map((b) => `• ${b}`) : lines.map(plain)
  )
    .filter(Boolean)
    .slice(0, max)
    .map((l) => (l.length > 110 ? `${l.slice(0, 109)}…` : l));
  return picked.join("\n") || "Nothing logged.";
};
const log = (msg: string) =>
  process.stdout.write(`${styleText("gray", new Date().toISOString())} ${msg}\n`);
const notify = (n: Notification) => runPromise(Effect.flatMap(Notifier, (x) => x.notify(n)));
const offerOpen = async (title: string, body: string): Promise<boolean> => {
  if (process.platform !== "linux") {
    await notify({ title, body });
    return true;
  }
  return notify({ title, body, action: "Open" });
};
const selfCommand = (...args: string[]) => [
  process.execPath,
  ...process.execArgv,
  process.argv[1]!,
  ...args,
];
interface Ctx {
  server?: {
    url: string;
    close: () => void;
  };
}
export const isRundownServer = async (port: number): Promise<boolean> => {
  try {
    const res = await fetch(`http://localhost:${port}/api/meta`, {
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json()) as {
      version?: unknown;
    };
    return typeof body.version === "string";
  } catch {
    return false;
  }
};
const openWeb = async (port: number, ctx: Ctx) => {
  if (!ctx.server) {
    const { startServer } = await import("../server");
    try {
      ctx.server = await startServer(port);
      log(`serving the web view on ${ctx.server.url}`);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EADDRINUSE" && !/in use/.test(err.message)) throw e;
      if (!(await isRundownServer(port))) {
        throw new Error(
          `port ${port} is taken by something other than rundown; set schedule.port to a free port`,
        );
      }
      log(`\`rundown serve\` is already running on port ${port}; using it`);
    }
  }
  openUrl(`http://localhost:${port}/morning`);
};
const deliver = async (cfg: Config, brief: Brief, ctx: Ctx) => {
  const label = brief.plan?.window.label ?? brief.recap?.window.label ?? "";
  const title = `Morning brief · ${label}`;
  const body = preview(brief.summary.text);
  switch (cfg.schedule.delivery) {
    case "notification":
      await notify({ title, body });
      log(`notified: ${title}`);
      return;
    case "file": {
      const file = path.join(paths.data, "briefs", `${brief.plan?.window.key ?? brief.key}.md`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `# ${title}\n\n${brief.summary.text.trim()}\n`);
      await notify({ title, body: `Saved to ${tilde(file)}` });
      log(`wrote ${file}`);
      return;
    }
    case "web":
      if (await offerOpen(title, body)) await openWeb(cfg.schedule.port, ctx);
      else log("notification dismissed");
      return;
    case "terminal":
      if (await offerOpen(title, body)) {
        const term = await openTerminal(selfCommand("morning"));
        log(
          term
            ? `opened ${term}`
            : "no terminal emulator found; set $TERMINAL or run `rundown morning`",
        );
      } else log("notification dismissed");
      return;
  }
};
const fire = async (cfg: Config, ctx: Ctx): Promise<boolean> => {
  try {
    log("building morning brief");
    const brief = await runPromise(Effect.flatMap(Briefs, (b) => b.build("morning")));
    const failed = brief.reports.filter((r) => r.status === "failed").map((r) => r.label);
    log(`built (${brief.summary.origin}${failed.length ? `; failed: ${failed.join(", ")}` : ""})`);
    await deliver(cfg, brief, ctx);
    return true;
  } catch (e) {
    reportFailure(e);
    await notify({
      title: "Morning brief failed",
      body:
        (
          e as {
            message?: string;
          }
        ).message ?? String(e),
    }).catch(() => false);
    return false;
  }
};
const MARKER = "Managed by rundown";
const UNIT = "rundown.service";
const LABEL = "dev.rundown.daemon";
const ENV_FILE = "~/.config/rundown/env";
const unitPath = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "systemd", "user", UNIT);
const plistPath = () => path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
const builtEntry = (): string | undefined =>
  [new URL("./main.mjs", import.meta.url), new URL("../../dist/main.mjs", import.meta.url)]
    .map((u) => fileURLToPath(u))
    .find((f) => fs.existsSync(f));
const serviceEnv = (): [string, string][] =>
  (["PATH", "RUNDOWN_CONFIG", "RUNDOWN_DATA_DIR"] as const).flatMap((k) =>
    process.env[k] ? [[k, process.env[k]!] as [string, string]] : [],
  );
const sdEscape = (s: string) => s.replace(/%/g, "%%").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
export const renderSystemdUnit = (
  node: string,
  entry: string,
  env: readonly [string, string][],
): string => `# ${MARKER} (\`rundown daemon --uninstall\` removes it).
# API keys (GROQ_API_KEY, GITHUB_TOKEN, LINEAR_API_KEY, ...) go in ${ENV_FILE},
# one KEY=value per line. Restart after editing: systemctl --user restart ${UNIT}
[Unit]
Description=Rundown morning brief scheduler
After=graphical-session.target network-online.target

[Service]
Type=simple
ExecStart="${sdEscape(node)}" "${sdEscape(entry)}" daemon
EnvironmentFile=-%h/.config/rundown/env
${env.map(([k, v]) => `Environment="${k}=${sdEscape(v)}"`).join("\n")}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const renderLaunchAgent = (
  node: string,
  entry: string,
  env: readonly [string, string][],
): string => {
  const logFile = path.join(home, "Library", "Logs", "rundown.log");
  const script = `set -a; [ -f "$HOME/.config/rundown/env" ] && . "$HOME/.config/rundown/env"; set +a; exec ${sh(node)} ${sh(entry)} daemon`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${MARKER} (rundown daemon --uninstall removes it).
     API keys (GROQ_API_KEY, GITHUB_TOKEN, ...) go in ${ENV_FILE}, one KEY=value per line;
     it is sourced before the daemon starts. Logs: ${tilde(logFile)} -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${xml(script)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env.map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
</dict>
</plist>
`;
};
const fail = async (msg: string, hint?: string): Promise<never> => {
  reportFailure({ message: msg, ...(hint ? { hint } : {}) });
  await disposeRuntime();
  process.exit(1);
};
const sh$ = (cmd: string, args: string[], quiet = false) => {
  if (!quiet) process.stdout.write(styleText("gray", `$ ${cmd} ${args.join(" ")}\n`));
  const r = spawnSync(cmd, args, {
    stdio: quiet ? "pipe" : "inherit",
    encoding: "utf8",
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
};
const WINDOWS_HELP = `Installing the daemon as a service isn't supported on Windows yet.
Run it manually (it stays in the foreground):
  rundown daemon
or create a Task Scheduler task that runs at log on:
  "${process.execPath}" "${builtEntry() ?? "<path to packages/cli/dist/main.mjs>"}" daemon
Put API keys in your user environment variables.
`;
const servicePath = () => (process.platform === "darwin" ? plistPath() : unitPath());
const ours = (file: string) =>
  fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(MARKER);
const install = async (yes: boolean) => {
  if (process.platform === "win32") return void process.stdout.write(WINDOWS_HELP);
  if (process.platform !== "linux" && process.platform !== "darwin") {
    return fail(
      `--install isn't supported on ${process.platform}`,
      "run `rundown daemon` from your own init system",
    );
  }
  const cfg = await run(RundownConfig);
  const entry = builtEntry();
  if (!entry) return fail("can't find the built CLI (dist/main.mjs)", "run `pnpm build` first");
  const file = servicePath();
  if (fs.existsSync(file) && !ours(file)) {
    return fail(`${file} exists and wasn't written by rundown; not touching it`);
  }
  const content =
    process.platform === "darwin"
      ? renderLaunchAgent(process.execPath, entry, serviceEnv())
      : renderSystemdUnit(process.execPath, entry, serviceEnv());
  process.stdout.write(
    `${styleText("bold", fs.existsSync(file) ? "Will replace" : "Will write")} ${file}:\n\n`,
  );
  process.stdout.write(`${styleText("gray", content)}\n`);
  if (!yes) {
    if (!isInteractive()) return fail("not a terminal; re-run with --yes to confirm");
    const ok = await p.confirm({ message: "Install and start the daemon?" });
    if (p.isCancel(ok) || !ok) return void (await disposeRuntime());
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (process.platform === "darwin") {
    sh$("launchctl", ["unload", file], true);
    if (!sh$("launchctl", ["load", "-w", file]).ok) return fail("launchctl load failed");
  } else {
    if (!sh$("systemctl", ["--user", "daemon-reload"]).ok)
      return fail("systemctl --user daemon-reload failed");
    if (!sh$("systemctl", ["--user", "enable", "--now", UNIT]).ok)
      return fail(`couldn't enable ${UNIT}`);
  }
  const envFile = path.join(home, ".config", "rundown", "env");
  const key = providerEnvKey[cfg.llm.provider];
  process.stdout.write(
    `\n${styleText("green", "✓")} installed. Morning brief at ${cfg.schedule.morningBrief} on workdays.\n`,
  );
  if (!fs.existsSync(envFile)) {
    process.stdout.write(
      styleText(
        "yellow",
        `  The service doesn't see your shell's env. Put API keys in ${ENV_FILE}` +
          `${key ? ` (e.g. ${key}=...)` : ""}, then restart it.\n`,
      ),
    );
  }
  process.stdout.write(
    styleText(
      "gray",
      process.platform === "darwin"
        ? `  logs: ~/Library/Logs/rundown.log\n`
        : `  logs: journalctl --user -u ${UNIT} -f\n`,
    ),
  );
  await disposeRuntime();
};
const uninstall = async () => {
  if (process.platform === "win32")
    return void process.stdout.write(
      "Nothing to uninstall: the Windows service isn't supported yet.\n",
    );
  const file = servicePath();
  if (!fs.existsSync(file))
    return void process.stdout.write(`not installed (${file} doesn't exist)\n`);
  if (!ours(file)) return fail(`${file} wasn't written by rundown; not touching it`);
  if (process.platform === "darwin") sh$("launchctl", ["unload", "-w", file]);
  else sh$("systemctl", ["--user", "disable", "--now", UNIT]);
  fs.rmSync(file);
  if (process.platform === "linux") sh$("systemctl", ["--user", "daemon-reload"]);
  process.stdout.write(`${styleText("green", "✓")} removed ${file}\n`);
};
const status = async () => {
  const yesNo = (b: boolean) => (b ? styleText("green", "yes") : styleText("gray", "no"));
  const line = (k: string, v: string) =>
    process.stdout.write(`${styleText("gray", k.padEnd(10))} ${v}\n`);
  if (process.platform === "linux" || process.platform === "darwin") {
    const file = servicePath();
    line("installed", `${yesNo(fs.existsSync(file))}  ${styleText("gray", tilde(file))}`);
    if (process.platform === "linux") {
      const active = sh$("systemctl", ["--user", "is-active", UNIT], true).out || "unknown";
      const enabled = sh$("systemctl", ["--user", "is-enabled", UNIT], true).out || "unknown";
      line("running", `${active === "active" ? styleText("green", active) : active} (${enabled})`);
    } else {
      line("running", yesNo(sh$("launchctl", ["list", LABEL], true).ok));
    }
  } else {
    line("installed", "not supported on this platform; run `rundown daemon` manually");
  }
  const cfg = await run(RundownConfig);
  const cal = makeCalendar(cfg.user.timezone, cfg.user.workdays);
  const next = nextRun(cfg);
  line("next", next ? when(cal, cfg.user.timezone, next) : "never (no workdays configured?)");
  line("delivery", cfg.schedule.delivery);
  line("last", readState().lastFired ?? "never");
  await disposeRuntime();
};
export default defineCommand({
  meta: {
    name: "daemon",
    description: "Deliver the morning brief on schedule (notification, terminal, web, or file)",
  },
  args: {
    now: {
      type: "boolean",
      description: "Build and deliver the morning brief once, right now, then exit",
    },
    install: {
      type: "boolean",
      description: "Install as a background service (systemd user unit / LaunchAgent)",
    },
    uninstall: {
      type: "boolean",
      description: "Stop and remove the background service",
    },
    status: {
      type: "boolean",
      description: "Is the service installed and running, and when is the next brief",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Don't ask before installing",
    },
  },
  async run({ args }) {
    if (args.install) return install(Boolean(args.yes));
    if (args.uninstall) return uninstall();
    if (args.status) return status();
    const cfg = await run(RundownConfig);
    const cal = makeCalendar(cfg.user.timezone, cfg.user.workdays);
    const ctx: Ctx = {};
    if (args.now) {
      const ok = await fire(cfg, ctx);
      if (ctx.server) {
        log("web view is up; Ctrl-C to stop");
        const stop = async () => {
          ctx.server?.close();
          await disposeRuntime();
          process.exit(0);
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        return;
      }
      await disposeRuntime();
      process.exit(ok ? 0 : 1);
    }
    const scheduler = startScheduler({
      cfg,
      fire: async () => void (await fire(cfg, ctx)),
      readLastFired: () => readState().lastFired,
      writeLastFired: (day) => writeState({ ...readState(), lastFired: day }),
      log,
    });
    const next = scheduler.nextRun();
    process.stdout.write(
      `${styleText("cyan", "rundown daemon")} next morning brief ${styleText("bold", next ? when(cal, cfg.user.timezone, next) : "never (no workdays configured)")}` +
        ` via ${cfg.schedule.delivery} (Ctrl-C to stop)\n`,
    );
    const stop = async () => {
      await scheduler.stop();
      ctx.server?.close();
      await disposeRuntime();
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  },
});
