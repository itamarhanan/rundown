import { Data } from "effect";
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly path?: string;
  readonly hint?: string;
}> {}
export class SourceError extends Data.TaggedError("SourceError")<{
  readonly source: string;
  readonly message: string;
  readonly hint?: string;
  readonly cause?: unknown;
}> {}
export class CacheError extends Data.TaggedError("CacheError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
export class LlmError extends Data.TaggedError("LlmError")<{
  readonly message: string;
  readonly hint?: string;
  readonly cause?: unknown;
}> {}
export class ProcessError extends Data.TaggedError("ProcessError")<{
  readonly command: string;
  readonly message: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}> {}
export class BriefError extends Data.TaggedError("BriefError")<{
  readonly message: string;
}> {}
export type RundownError =
  | ConfigError
  | SourceError
  | CacheError
  | LlmError
  | ProcessError
  | BriefError;
export const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
