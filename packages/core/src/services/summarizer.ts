import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";
import { Context, Effect, Layer } from "effect";
import { createHash } from "node:crypto";
import { RundownConfig, providerEnvKey } from "../config/load";
import type { Config } from "../config/schema";
import type { Brief } from "../domain/brief";
import { buildPrompt } from "../domain/prompt";
import { makeCalendar } from "../domain/window";
import { LlmError, describeCause } from "../errors";
export interface Generated {
  readonly text: string;
  readonly model: string;
  readonly hash: string;
}
export type Availability =
  | {
      readonly ok: true;
      readonly model: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };
const modelFor = (llm: Config["llm"]): LanguageModel => {
  const model = llm.model!;
  const key = llm.apiKey ? { apiKey: llm.apiKey } : {};
  switch (llm.provider) {
    case "groq":
      return createGroq(key)(model);
    case "openai":
      return createOpenAI(key)(model);
    case "anthropic":
      return createAnthropic(key)(model);
    case "nvidia":
      return createOpenAICompatible({
        name: "nvidia",
        baseURL: llm.baseUrl ?? "https://integrate.api.nvidia.com/v1",
        ...key,
      })(model);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: llm.baseUrl ?? "http://localhost:11434/v1",
      })(model);
  }
};
export const llmAvailability = (llm: Config["llm"]): Availability => {
  const label = `${llm.provider}/${llm.model}`;
  if (!llm.enabled) return { ok: false, reason: "LLM disabled in config (llm.enabled: false)" };
  const envKey = providerEnvKey[llm.provider];
  if (envKey && !llm.apiKey) {
    return {
      ok: false,
      reason: `no ${envKey} in your environment; export ${envKey}=… in your shell to get LLM-written standups from ${label}`,
    };
  }
  return { ok: true, model: label };
};
export class Summarizer extends Context.Tag("rundown/Summarizer")<
  Summarizer,
  {
    readonly availability: Availability;
    readonly hashFor: (brief: Brief) => string;
    readonly summarize: (brief: Brief) => Effect.Effect<Generated, LlmError>;
  }
>() {
  static readonly Live = Layer.effect(
    Summarizer,
    Effect.gen(function* () {
      const cfg = yield* RundownConfig;
      const cal = makeCalendar(cfg.user.timezone, cfg.user.workdays);
      const avail = llmAvailability(cfg.llm);
      const label = `${cfg.llm.provider}/${cfg.llm.model}`;
      const promptFor = (brief: Brief) =>
        buildPrompt(brief, cal, {
          maxWords: cfg.llm.maxWords,
          ...(cfg.llm.instructions ? { instructions: cfg.llm.instructions } : {}),
        });
      const hashOf = (p: { system: string; prompt: string }) =>
        createHash("sha256")
          .update(label)
          .update("\0")
          .update(p.system)
          .update("\0")
          .update(p.prompt)
          .digest("hex");
      return {
        availability: avail,
        hashFor: (brief) => hashOf(promptFor(brief)),
        summarize: (brief) =>
          Effect.gen(function* () {
            if (!avail.ok)
              return yield* new LlmError({
                message: avail.reason,
                hint: "falling back to the plain digest",
              });
            const p = promptFor(brief);
            const { text } = yield* Effect.tryPromise({
              try: (signal) =>
                generateText({
                  model: modelFor(cfg.llm),
                  system: p.system,
                  prompt: p.prompt,
                  maxRetries: 1,
                  abortSignal: signal,
                }),
              catch: (e) => new LlmError({ message: `${label}: ${describeCause(e)}`, cause: e }),
            }).pipe(
              Effect.timeoutFail({
                duration: "60 seconds",
                onTimeout: () => new LlmError({ message: `${label} took longer than 60s` }),
              }),
            );
            const clean = text.trim();
            if (!clean)
              return yield* new LlmError({ message: `${label} returned an empty response` });
            return { text: clean, model: label, hash: hashOf(p) };
          }),
      };
    }),
  );
}
