import { Schema } from "effect";
const systemTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const TimeZone = Schema.String.pipe(
  Schema.filter(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    {
      message: (issue) =>
        `unknown time zone "${String(issue.actual)}" (use an IANA name like Asia/Jerusalem)`,
    },
  ),
);
const Weekday = Schema.Int.pipe(
  Schema.between(0, 6),
  Schema.annotations({ description: "0 = Sunday" }),
);
const HHMM = Schema.String.pipe(
  Schema.pattern(/^([01]?\d|2[0-3]):[0-5]\d$/, {
    message: () => 'expected a 24h time like "08:30"',
  }),
);
const on = <A>(s: Schema.Schema<A, A>, value: A) =>
  Schema.optionalWith(s, { default: () => value });
export const Providers = ["groq", "openai", "anthropic", "nvidia", "ollama"] as const;
export const Provider = Schema.Literal(...Providers);
export type Provider = typeof Provider.Type;
export const AgentNames = ["opencode", "claude", "cursor", "aider", "codex", "vscode"] as const;
export type AgentName = (typeof AgentNames)[number];
export const UserConfig = Schema.Struct({
  name: Schema.String,
  email: Schema.optional(Schema.String),
  timezone: Schema.optionalWith(TimeZone, { default: systemTimeZone }),
  workdays: on(Schema.Array(Weekday), [1, 2, 3, 4, 5]),
});
export const LlmConfig = Schema.Struct({
  enabled: on(Schema.Boolean, true),
  provider: on(Provider, "groq"),
  model: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  baseUrl: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  maxWords: on(Schema.Int.pipe(Schema.between(30, 1000)), 150),
});
export const GitConfig = Schema.Struct({
  enabled: on(Schema.Boolean, true),
  repos: on(Schema.Array(Schema.String), []),
  authors: on(Schema.Array(Schema.String), []),
  depth: on(Schema.Int.pipe(Schema.between(0, 6)), 3),
});
export const GithubConfig = Schema.Struct({
  enabled: on(Schema.Boolean, true),
  token: Schema.optional(Schema.String),
  apiUrl: on(Schema.String, "https://api.github.com"),
  orgs: on(Schema.Array(Schema.String), []),
});
export const LinearConfig = Schema.Struct({
  enabled: on(Schema.Boolean, true),
  apiKey: Schema.optional(Schema.String),
});
export const CalendarConfig = Schema.Struct({
  enabled: on(Schema.Boolean, true),
  ics: on(Schema.Array(Schema.String), []),
  icsUrl: Schema.optional(Schema.String),
  icsFile: Schema.optional(Schema.String),
  hideDeclined: on(Schema.Boolean, true),
});
export const AgentsConfig = Schema.Struct({
  opencode: on(Schema.Boolean, true),
  claude: on(Schema.Boolean, true),
  cursor: on(Schema.Boolean, true),
  aider: on(Schema.Boolean, true),
  codex: on(Schema.Boolean, true),
  vscode: on(Schema.Boolean, true),
});
export const ShellConfig = Schema.Struct({
  enabled: on(Schema.Boolean, false),
  historyFile: Schema.optional(Schema.String),
  allow: on(Schema.Array(Schema.String), [
    "git push",
    "gh pr create",
    "gh pr merge",
    "gh release",
    "npm publish",
    "pnpm publish",
    "docker push",
    "kubectl apply",
    "terraform apply",
    "vercel",
    "fly deploy",
  ]),
});
export const Delivery = Schema.Literal("notification", "terminal", "web", "file");
export type Delivery = typeof Delivery.Type;
export const ScheduleConfig = Schema.Struct({
  morningBrief: on(HHMM, "08:30"),
  delivery: on(Delivery, "notification"),
  port: on(Schema.Int.pipe(Schema.between(1, 65535)), 4477),
});
const section = <F extends Schema.Struct.Fields>(s: Schema.Struct<F>) =>
  Schema.optionalWith(s, {
    default: () =>
      Schema.decodeSync(
        s as unknown as Schema.Schema<Schema.Struct.Type<F>, Schema.Struct.Encoded<F>>,
      )({} as Schema.Struct.Encoded<F>),
  });
export const ConfigSchema = Schema.Struct({
  user: UserConfig,
  llm: section(LlmConfig),
  sources: section(
    Schema.Struct({
      git: section(GitConfig),
      github: section(GithubConfig),
      linear: section(LinearConfig),
      calendar: section(CalendarConfig),
      agents: section(AgentsConfig),
      shell: section(ShellConfig),
    }),
  ),
  schedule: section(ScheduleConfig),
});
export type Config = typeof ConfigSchema.Type;
export type ConfigInput = typeof ConfigSchema.Encoded;
