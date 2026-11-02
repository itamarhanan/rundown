import { Context, Effect, Layer } from "effect";
import { RundownConfig } from "../config/load";
import type { Config } from "../config/schema";
import type { DateWindow } from "../domain/activity";
import { discoverRepos } from "../sources/git";
import { type SourceReport, probe } from "../sources/source";
import { makeAiderAdapter } from "./aider";
import type { AgentAdapter, AgentSession } from "./agent";
import { makeClaudeAdapter } from "./claude";
import { makeCodexAdapter } from "./codex";
import { makeCursorAdapter } from "./cursor";
import { makeOpenCodeAdapter } from "./opencode";
import { makeVsCodeAdapter } from "./vscode";
export const agentAdaptersFor = (cfg: Config): AgentAdapter[] => {
  const on = cfg.sources.agents;
  let repos: string[] | undefined;
  const gitRepos = () => (repos ??= discoverRepos(cfg.sources.git.repos, cfg.sources.git.depth));
  return [
    on.opencode && makeOpenCodeAdapter(),
    on.claude && makeClaudeAdapter(),
    on.cursor && makeCursorAdapter(),
    on.codex && makeCodexAdapter(),
    on.vscode && makeVsCodeAdapter(),
    on.aider && makeAiderAdapter(gitRepos),
  ].filter((a): a is AgentAdapter => Boolean(a));
};
export class AgentRegistry extends Context.Tag("rundown/AgentRegistry")<
  AgentRegistry,
  {
    readonly adapters: readonly AgentAdapter[];
  }
>() {
  static readonly Live = Layer.effect(
    AgentRegistry,
    Effect.map(RundownConfig, (cfg) => ({ adapters: agentAdaptersFor(cfg) })),
  );
  static readonly layer = (adapters: readonly AgentAdapter[]) =>
    Layer.succeed(AgentRegistry, { adapters });
}
export interface AgentRun {
  readonly sessions: readonly AgentSession[];
  readonly reports: readonly SourceReport[];
}
export class AgentService extends Context.Tag("rundown/AgentService")<
  AgentService,
  {
    readonly sessions: (
      window: DateWindow,
      onReport?: (r: SourceReport) => void,
    ) => Effect.Effect<AgentRun>;
  }
>() {
  static readonly Live = Layer.effect(
    AgentService,
    Effect.gen(function* () {
      const { adapters } = yield* AgentRegistry;
      return {
        sessions: (window, onReport) =>
          Effect.forEach(
            adapters,
            (a) =>
              probe(
                { id: `agent:${a.name}`, label: a.label, detect: a.detect },
                a.fetchSessions(window),
              ).pipe(Effect.tap((p) => Effect.sync(() => onReport?.(p.report)))),
            { concurrency: "unbounded" },
          ).pipe(
            Effect.map((probes) => ({
              sessions: probes.flatMap((p) => p.value),
              reports: probes.map((p) => p.report),
            })),
          ),
      };
    }),
  );
}
