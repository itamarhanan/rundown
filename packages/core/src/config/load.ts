import { Context, Effect, Either, Layer, ParseResult, Schema } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import YAML from "yaml";
import { ConfigError } from "../errors";
import { type Config, ConfigSchema, type Provider } from "./schema";
const home = os.homedir();
const xdg = (envVar: string, fallback: string) => process.env[envVar] || path.join(home, fallback);
export const paths = {
  get config(): string {
    return (
      process.env.RUNDOWN_CONFIG ||
      path.join(xdg("XDG_CONFIG_HOME", ".config"), "rundown", "config.yaml")
    );
  },
  get data(): string {
    return (
      process.env.RUNDOWN_DATA_DIR || path.join(xdg("XDG_DATA_HOME", ".local/share"), "rundown")
    );
  },
};
export const providerEnvKey: Record<Provider, string | undefined> = {
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  ollama: undefined,
};
export const defaultModel: Record<Provider, string> = {
  groq: "openai/gpt-oss-120b",
  openai: "gpt-5-mini",
  anthropic: "claude-haiku-5-5",
  nvidia: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  ollama: "llama3.2",
};
export const expandHome = (p: string): string =>
  p === "~" ? home : p.startsWith("~/") ? path.join(home, p.slice(2)) : p;
const interpolate = (value: unknown): unknown => {
  if (typeof value === "string") {
    const out = value.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (_, name: string) => process.env[name] ?? "",
    );
    return out === "" && value !== "" ? undefined : out;
  }
  if (Array.isArray(value)) return value.map(interpolate).filter((v) => v !== undefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, interpolate(v)] as const)
        .filter(([, v]) => v !== undefined && v !== null),
    );
  }
  return value;
};
const normalize = (cfg: Config): Config => {
  const cal = cfg.sources.calendar;
  const ics = [...cal.ics, cal.icsUrl, cal.icsFile]
    .filter((s): s is string => Boolean(s))
    .map((s) => (/^(https?|webcal):/.test(s) ? s : expandHome(s)));
  const llmKey =
    cfg.llm.apiKey ??
    (providerEnvKey[cfg.llm.provider] ? process.env[providerEnvKey[cfg.llm.provider]!] : undefined);
  return {
    ...cfg,
    llm: {
      ...cfg.llm,
      model: cfg.llm.model ?? defaultModel[cfg.llm.provider],
      apiKey: llmKey,
    },
    sources: {
      ...cfg.sources,
      git: {
        ...cfg.sources.git,
        repos: [...new Set(cfg.sources.git.repos.map(expandHome))],
      },
      calendar: { ...cal, ics: [...new Set(ics)] },
      shell: cfg.sources.shell.historyFile
        ? {
            ...cfg.sources.shell,
            historyFile: expandHome(cfg.sources.shell.historyFile),
          }
        : cfg.sources.shell,
    },
  };
};
export const decodeConfig = (raw: unknown, source = "config"): Effect.Effect<Config, ConfigError> =>
  Effect.gen(function* () {
    const result = Schema.decodeUnknownEither(ConfigSchema, { errors: "all" })(interpolate(raw));
    if (Either.isLeft(result)) {
      const issues = ParseResult.ArrayFormatter.formatErrorSync(result.left)
        .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      return yield* new ConfigError({
        message: `invalid ${source}:\n${issues}`,
        path: source,
      });
    }
    return normalize(result.right);
  });
export const loadConfigFile = (file: string = paths.config): Effect.Effect<Config, ConfigError> =>
  Effect.gen(function* () {
    if (!fs.existsSync(file)) {
      return yield* new ConfigError({
        message: `no config at ${file}`,
        path: file,
        hint: "run `rundown init` to create one",
      });
    }
    const raw = yield* Effect.try({
      try: () => YAML.parse(fs.readFileSync(file, "utf8")) as unknown,
      catch: (e) =>
        new ConfigError({
          message: `can't parse ${file}: ${String(e)}`,
          path: file,
        }),
    });
    return yield* decodeConfig(raw ?? {}, file);
  });
export class RundownConfig extends Context.Tag("rundown/Config")<RundownConfig, Config>() {
  static readonly Live = Layer.effect(RundownConfig, loadConfigFile());
  static readonly fromFile = (file: string) => Layer.effect(RundownConfig, loadConfigFile(file));
  static readonly fromObject = (raw: unknown) => Layer.effect(RundownConfig, decodeConfig(raw));
}
