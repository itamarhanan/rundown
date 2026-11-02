import { Effect, Either } from "effect";
import * as os from "node:os";
import * as path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { decodeConfig, defaultModel } from "../src/config/load";
import { renderConfig } from "../src/config/template";
const decode = (raw: unknown) => Effect.runSync(Effect.either(decodeConfig(raw, "test.yaml")));
const ok = (raw: unknown) => {
  const r = decode(raw);
  if (Either.isLeft(r)) throw new Error(r.left.message);
  return r.right;
};
describe("decodeConfig", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("fills in every default from just a name", () => {
    const cfg = ok({ user: { name: "Ada", timezone: "UTC" } });
    expect(cfg.user.workdays).toEqual([1, 2, 3, 4, 5]);
    expect(cfg.llm).toMatchObject({
      enabled: true,
      provider: "groq",
      model: defaultModel.groq,
      maxWords: 150,
    });
    expect(cfg.schedule).toEqual({ morningBrief: "08:30", delivery: "notification", port: 4477 });
    expect(cfg.sources.shell.enabled).toBe(false);
    expect(cfg.sources.agents).toEqual({
      opencode: true,
      claude: true,
      cursor: true,
      aider: true,
      codex: true,
      vscode: true,
    });
    expect(cfg.sources.git).toMatchObject({ enabled: true, repos: [], authors: [], depth: 3 });
  });
  it("defaults the time zone to the machine's", () => {
    expect(ok({ user: { name: "Ada" } }).user.timezone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
  it("interpolates ${VAR} and drops keys whose variable is unset", () => {
    process.env.RD_TEST_TOKEN = "ghp_secret";
    delete process.env.RD_TEST_MISSING;
    const cfg = ok({
      user: { name: "Ada", timezone: "UTC" },
      sources: {
        github: { token: "${RD_TEST_TOKEN}" },
        linear: { apiKey: "${RD_TEST_MISSING}" },
        git: {
          repos: ["/src/${RD_TEST_MISSING}", "/work/${RD_TEST_TOKEN}"],
          authors: ["${RD_TEST_MISSING}"],
        },
      },
    });
    expect(cfg.sources.github.token).toBe("ghp_secret");
    expect(cfg.sources.linear.apiKey).toBeUndefined();
    expect(cfg.sources.git.repos).toEqual(["/src/", "/work/ghp_secret"]);
    expect(cfg.sources.git.authors).toEqual([]);
  });
  it("takes the LLM key from the provider's env var", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(
      ok({ user: { name: "Ada", timezone: "UTC" }, llm: { provider: "openai" } }).llm,
    ).toMatchObject({
      apiKey: "sk-test",
      model: defaultModel.openai,
    });
  });
  it("explains an unknown time zone, with its path", () => {
    const r = decode({ user: { name: "Ada", timezone: "Mars/Olympus" } });
    expect(Either.isLeft(r)).toBe(true);
    const e = Either.getLeft(r).pipe((o) => (o._tag === "Some" ? o.value : undefined))!;
    expect(e._tag).toBe("ConfigError");
    expect(e.message).toContain("invalid test.yaml");
    expect(e.message).toContain(
      'user.timezone: unknown time zone "Mars/Olympus" (use an IANA name like Asia/Jerusalem)',
    );
  });
  it("reports every problem at once", () => {
    const r = decode({
      user: { workdays: [7] },
      schedule: { morningBrief: "8.30", delivery: "pigeon" },
    });
    const msg = Either.isLeft(r) ? r.left.message : "";
    expect(msg).toContain("user.name");
    expect(msg).toContain("user.workdays.0");
    expect(msg).toContain('schedule.morningBrief: expected a 24h time like "08:30"');
    expect(msg).toContain("schedule.delivery");
  });
  it("folds legacy icsUrl/icsFile into ics, expanding ~ and de-duplicating", () => {
    const cfg = ok({
      user: { name: "Ada", timezone: "UTC" },
      sources: {
        calendar: {
          ics: ["https://example.com/a.ics", "~/cal/work.ics"],
          icsUrl: "webcal://example.com/b.ics",
          icsFile: "~/cal/work.ics",
        },
      },
    });
    expect(cfg.sources.calendar.ics).toEqual([
      "https://example.com/a.ics",
      path.join(os.homedir(), "cal/work.ics"),
      "webcal://example.com/b.ics",
    ]);
  });
  it("expands ~ in repos and the shell history file", () => {
    const cfg = ok({
      user: { name: "Ada", timezone: "UTC" },
      sources: { git: { repos: ["~/work", "~/work"] }, shell: { historyFile: "~/.zsh_history" } },
    });
    expect(cfg.sources.git.repos).toEqual([path.join(os.homedir(), "work")]);
    expect(cfg.sources.shell.historyFile).toBe(path.join(os.homedir(), ".zsh_history"));
  });
});
describe("renderConfig", () => {
  it("round-trips through YAML and decodeConfig", () => {
    const yaml = renderConfig({
      name: 'Itamar "the dev"',
      email: "itamar@example.com",
      timezone: "Asia/Jerusalem",
      workdays: [0, 1, 2, 3, 4],
      provider: "anthropic",
      repos: [path.join(os.homedir(), "work"), "/srv/repo: with colon"],
      authors: ["itamar", "itamar@example.com"],
      agents: ["claude", "codex"],
      ics: ["https://calendar.example.com/x.ics?a=1&b=2"],
      linear: false,
      morningBrief: "09:15",
      delivery: "web",
    });
    expect(yaml).not.toMatch(/apiKey|sk-|ghp_/);
    const cfg = ok(YAML.parse(yaml));
    expect(cfg.user).toEqual({
      name: 'Itamar "the dev"',
      email: "itamar@example.com",
      timezone: "Asia/Jerusalem",
      workdays: [0, 1, 2, 3, 4],
    });
    expect(cfg.llm).toMatchObject({
      provider: "anthropic",
      model: defaultModel.anthropic,
      maxWords: 150,
    });
    expect(cfg.sources.git.repos).toEqual([
      path.join(os.homedir(), "work"),
      "/srv/repo: with colon",
    ]);
    expect(cfg.sources.git.authors).toEqual(["itamar", "itamar@example.com"]);
    expect(cfg.sources.agents).toEqual({
      opencode: false,
      claude: true,
      cursor: false,
      aider: false,
      codex: true,
      vscode: false,
    });
    expect(cfg.sources.calendar.ics).toEqual(["https://calendar.example.com/x.ics?a=1&b=2"]);
    expect(cfg.sources.linear.enabled).toBe(false);
    expect(cfg.sources.shell.enabled).toBe(false);
    expect(cfg.schedule).toEqual({ morningBrief: "09:15", delivery: "web", port: 4477 });
  });
  it("renders empty lists as []", () => {
    const yaml = renderConfig({
      name: "A",
      timezone: "UTC",
      workdays: [1],
      provider: "ollama",
      repos: [],
      authors: [],
      agents: [],
      ics: [],
      linear: true,
      morningBrief: "08:00",
      delivery: "notification",
    });
    const cfg = ok(YAML.parse(yaml));
    expect(cfg.sources.git.repos).toEqual([]);
    expect(cfg.sources.calendar.ics).toEqual([]);
    expect(cfg.llm.provider).toBe("ollama");
  });
});
