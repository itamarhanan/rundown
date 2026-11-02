import { FetchHttpClient } from "@effect/platform";
import { Layer } from "effect";
import { AgentRegistry, AgentService } from "./agents/registry";
import { RundownConfig } from "./config/load";
import { Sources } from "./sources/registry";
import { Aggregator } from "./services/aggregator";
import { Briefs } from "./services/briefs";
import { Cache } from "./services/cache";
import { Notifier } from "./services/notifier";
import { Summarizer } from "./services/summarizer";
export const RundownLive = (
  overrides: {
    readonly config?: Layer.Layer<RundownConfig, unknown>;
    readonly cache?: Layer.Layer<Cache, unknown>;
  } = {},
) => {
  const config = overrides.config ?? RundownConfig.Live;
  const cache = overrides.cache ?? Cache.Live;
  const agents = AgentService.Live.pipe(Layer.provideMerge(AgentRegistry.Live));
  const sources = Sources.Live.pipe(Layer.provide(FetchHttpClient.layer));
  const aggregator = Aggregator.Live.pipe(Layer.provideMerge(Layer.merge(sources, agents)));
  const briefs = Briefs.Live.pipe(
    Layer.provideMerge(Layer.mergeAll(aggregator, cache, Summarizer.Live)),
  );
  return Layer.mergeAll(briefs, Notifier.Live).pipe(Layer.provideMerge(config));
};
