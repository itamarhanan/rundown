import * as p from "@clack/prompts";
import {
  type AgentName,
  type ConfigDraft,
  type Delivery,
  type Provider,
  Providers,
  defaultModel,
  discoverRepos,
  exec,
  loadConfigFile,
  makeClaudeAdapter,
  makeCodexAdapter,
  makeCursorAdapter,
  makeGithubSource,
  makeOpenCodeAdapter,
  makeVsCodeAdapter,
  paths,
  providerEnvKey,
  renderConfig,
} from "@rundown/core";
import { FetchHttpClient } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { styleText } from "node:util";
import { isInteractive } from "../util/system";
const home = os.homedir();
const tilde = (s: string) => (s.startsWith(home) ? `~${s.slice(home.length)}` : s);
const gitConfig = (key: string) =>
  Effect.runPromise(
    exec("git", ["config", "--global", key], { timeoutMs: 3000 }).pipe(
      Effect.map((s) => s.trim()),
      Effect.orElseSucceed(() => ""),
    ),
  );
const ROOT_CANDIDATES = [
  "Desktop",
  "Projects",
  "projects",
  "code",
  "Code",
  "dev",
  "src",
  "work",
  "repos",
  "git",
  "Developer",
];
const findRepoRoots = () =>
  ROOT_CANDIDATES.map((d) => path.join(home, d))
    .filter((d) => fs.existsSync(d))
    .map((d) => ({ dir: d, repos: discoverRepos([d], 3).length }))
    .filter((r) => r.repos > 0);
const detectAgents = async (): Promise<Record<AgentName, boolean>> => {
  const adapters = {
    opencode: makeOpenCodeAdapter(),
    claude: makeClaudeAdapter(),
    cursor: makeCursorAdapter(),
    codex: makeCodexAdapter(),
    vscode: makeVsCodeAdapter(),
  };
  const out = { aider: true } as Record<AgentName, boolean>;
  await Promise.all(
    Object.entries(adapters).map(async ([name, a]) => {
      out[name as AgentName] = (await Effect.runPromise(a.detect)).available;
    }),
  );
  return out;
};
const detectGithub = () =>
  Effect.runPromise(
    makeGithubSource({}).pipe(
      Effect.flatMap((s) => s.detect),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
const guessWorkdays = (tz: string) =>
  tz === "Asia/Jerusalem" || tz === "Asia/Tel_Aviv" ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
const guessProvider = (): Provider =>
  Providers.find((pr) => {
    const k = providerEnvKey[pr];
    return k !== undefined && Boolean(process.env[k]);
  }) ?? "groq";
const AGENT_LABELS: Record<AgentName, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex CLI",
  vscode: "VS Code chat (Copilot)",
  aider: "Aider",
};
const ask = async <T>(prompt: Promise<T>): Promise<Exclude<T, symbol>> => {
  const v = await prompt;
  if (p.isCancel(v)) {
    p.cancel("Cancelled. Nothing was written.");
    process.exit(0);
  }
  return v as Exclude<T, symbol>;
};
export default defineCommand({
  meta: { name: "init", description: "Set up rundown: repos, agents, calendar, LLM" },
  args: {
    yes: { type: "boolean", alias: "y", description: "Accept detected defaults without prompting" },
    force: {
      type: "boolean",
      alias: "f",
      description: "Overwrite an existing config without asking",
    },
  },
  async run({ args }) {
    const interactive = isInteractive() && !args.yes;
    p.intro(styleText(["bgCyan", "black"], " rundown init "));
    const spin = p.spinner();
    spin.start("Looking around: git identity, repos, agents, GitHub");
    const [name, email, roots, agents, github] = await Promise.all([
      gitConfig("user.name"),
      gitConfig("user.email"),
      Promise.resolve(findRepoRoots()),
      detectAgents(),
      detectGithub(),
    ]);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    spin.stop("Found what I could");
    p.note(
      [
        `git identity   ${name || "?"} <${email || "?"}>`,
        `time zone      ${timezone}`,
        `repo folders   ${roots.map((r) => `${tilde(r.dir)} (${r.repos})`).join(", ") || "none found"}`,
        `agents         ${
          (Object.keys(agents) as AgentName[])
            .filter((a) => agents[a] && a !== "aider")
            .map((a) => AGENT_LABELS[a])
            .join(", ") || "none"
        }`,
        `GitHub         ${github.available ? github.detail : "not connected (run gh auth login)"}`,
      ].join("\n"),
      "Detected",
    );
    let draft: ConfigDraft = {
      name: name || os.userInfo().username,
      ...(email ? { email } : {}),
      timezone,
      workdays: guessWorkdays(timezone),
      provider: guessProvider(),
      repos: roots.map((r) => r.dir),
      authors: [name, email].filter(Boolean),
      agents: (Object.keys(agents) as AgentName[]).filter((a) => agents[a]),
      ics: [],
      linear: Boolean(process.env.LINEAR_API_KEY),
      morningBrief: "08:30",
      delivery: "notification",
    };
    if (interactive) {
      const userName = await ask(
        p.text({ message: "Your name (used in the standup voice)", initialValue: draft.name }),
      );
      const workdays = await ask(
        p.select({
          message: "Your work week",
          initialValue: draft.workdays.join(","),
          options: [
            { value: "1,2,3,4,5", label: "Monday – Friday" },
            { value: "0,1,2,3,4", label: "Sunday – Thursday" },
            { value: "6,0,1,2,3", label: "Saturday – Wednesday" },
          ],
        }),
      );
      const repos = await ask(
        p.multiselect({
          message: "Folders to scan for git repos (new repos are picked up automatically)",
          required: false,
          options: roots.map((r) => ({
            value: r.dir,
            label: tilde(r.dir),
            hint: `${r.repos} repos`,
          })),
          initialValues: roots.map((r) => r.dir),
        }),
      );
      const extra = await ask(
        p.text({
          message: "Other repo folders (comma-separated, optional)",
          placeholder: "~/clients, ~/oss/thing",
        }),
      );
      const agentPick = await ask(
        p.multiselect({
          message: "Coding agents to include",
          required: false,
          options: (Object.keys(AGENT_LABELS) as AgentName[]).map((a) => ({
            value: a,
            label: AGENT_LABELS[a],
            ...(a !== "aider"
              ? { hint: agents[a] ? "detected" : "not found" }
              : { hint: "reads .aider.chat.history.md in your repos" }),
          })),
          initialValues: draft.agents as AgentName[],
        }),
      );
      const provider = await ask(
        p.select({
          message: "LLM for writing the standup (your key, read from env at runtime)",
          initialValue: draft.provider,
          options: Providers.map((pr) => {
            const k = providerEnvKey[pr];
            return {
              value: pr,
              label: pr,
              hint: k
                ? `${defaultModel[pr]} · ${process.env[k] ? `$${k} is set` : `needs $${k}`}`
                : `${defaultModel[pr]} · local`,
            };
          }),
        }),
      );
      const ics = await ask(
        p.text({
          message:
            "Calendar ICS URL or file (optional). Google: Settings → your calendar → Secret address in iCal format",
          placeholder: "https://calendar.google.com/calendar/ical/…/basic.ics",
          validate: (v) =>
            !v || /^(https?|webcal):\/\//.test(v) || fs.existsSync(v.replace(/^~/, home))
              ? undefined
              : "Not a URL or an existing file",
        }),
      );
      const time = await ask(
        p.text({
          message: "Morning brief time (for `rundown daemon`)",
          initialValue: draft.morningBrief,
          validate: (v) =>
            /^([01]?\d|2[0-3]):[0-5]\d$/.test(v ?? "") ? undefined : "Use 24h HH:MM",
        }),
      );
      const delivery = await ask(
        p.select<Delivery>({
          message: "When the morning brief is ready",
          initialValue: draft.delivery,
          options: [
            { value: "notification", label: "Desktop notification" },
            { value: "web", label: "Notification that opens the web view" },
            { value: "terminal", label: "Notification that opens the terminal view" },
            { value: "file", label: "Write it to a Markdown file" },
          ],
        }),
      );
      draft = {
        ...draft,
        name: userName.trim() || draft.name,
        workdays: workdays.split(",").map(Number),
        repos: [
          ...repos,
          ...extra
            .split(",")
            .map((s) => s.trim().replace(/^~(?=\/|$)/, home))
            .filter(Boolean),
        ],
        agents: agentPick,
        provider,
        ics: ics?.trim() ? [ics.trim()] : [],
        morningBrief: time,
        delivery,
      };
    }
    const file = paths.config;
    if (fs.existsSync(file) && !args.force) {
      const overwrite = interactive
        ? await ask(
            p.confirm({
              message: `${tilde(file)} exists. Replace it? (the old one is kept as .bak)`,
              initialValue: false,
            }),
          )
        : false;
      if (!overwrite) {
        p.outro(
          `Kept your existing config. Re-run with ${styleText("cyan", "--force")} to replace it.`,
        );
        return;
      }
    }
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderConfig(draft));
    const check = await Effect.runPromiseExit(loadConfigFile(file));
    if (check._tag === "Failure") {
      p.log.error("The written config didn't validate. This is a bug; please report it.");
      process.exitCode = 1;
      return;
    }
    p.log.success(`Wrote ${tilde(file)}`);
    const envKey = providerEnvKey[draft.provider];
    const steps = [
      ...(envKey && !process.env[envKey]
        ? [`export ${envKey}=…   ${styleText("gray", "(add to your shell profile)")}`]
        : []),
      ...(!github.available
        ? [`gh auth login          ${styleText("gray", "(PRs and reviews)")}`]
        : []),
      `rundown sources test   ${styleText("gray", "(check every source)")}`,
      `rundown yesterday      ${styleText("gray", "(your standup)")}`,
      `rundown daemon --install ${styleText("gray", `(morning brief at ${draft.morningBrief})`)}`,
    ];
    p.note(steps.join("\n"), "Next");
    p.outro("Done.");
  },
});
