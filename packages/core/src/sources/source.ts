import { Cause, Clock, Duration, Effect, Option } from "effect";
import type { Activity, DateWindow, OpenItem } from "../domain/activity";
import { SourceError, describeCause } from "../errors";
export interface Detection {
  readonly available: boolean;
  readonly detail: string;
}
export const detected = (detail: string): Detection => ({ available: true, detail });
export const notDetected = (detail: string): Detection => ({ available: false, detail });
export interface Source {
  readonly id: string;
  readonly label: string;
  readonly detect: Effect.Effect<Detection>;
  readonly activities: (window: DateWindow) => Effect.Effect<readonly Activity[], SourceError>;
  readonly openItems?: Effect.Effect<readonly OpenItem[], SourceError>;
}
export type SourceStatus = "ok" | "skipped" | "failed";
export interface SourceReport {
  readonly id: string;
  readonly label: string;
  readonly status: SourceStatus;
  readonly detail: string;
  readonly count: number;
  readonly durationMs: number;
  readonly hint?: string;
}
export interface Probe<A> {
  readonly report: SourceReport;
  readonly value: readonly A[];
}
export const DEFAULT_TIMEOUT = Duration.seconds(25);
export const probe = <A>(
  src: {
    readonly id: string;
    readonly label: string;
    readonly detect: Effect.Effect<Detection>;
  },
  fetch: Effect.Effect<readonly A[], SourceError>,
  timeout: Duration.DurationInput = DEFAULT_TIMEOUT,
): Effect.Effect<Probe<A>> =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    const elapsed = Effect.map(Clock.currentTimeMillis, (t) => t - started);
    const base = { id: src.id, label: src.label };
    const detection = yield* src.detect;
    if (!detection.available) {
      return {
        report: { ...base, status: "skipped", detail: detection.detail, count: 0, durationMs: 0 },
        value: [],
      } satisfies Probe<A>;
    }
    return yield* fetch.pipe(
      Effect.timeoutFail({
        duration: timeout,
        onTimeout: () =>
          new SourceError({
            source: src.id,
            message: `timed out after ${Duration.format(timeout)}`,
          }),
      }),
      Effect.flatMap((value) =>
        Effect.map(elapsed, (durationMs): Probe<A> => ({
          report: {
            ...base,
            status: "ok",
            detail: detection.detail,
            count: value.length,
            durationMs,
          },
          value,
        })),
      ),
      Effect.catchAllCause((cause) =>
        Effect.map(elapsed, (durationMs): Probe<A> => {
          const failure = Option.getOrUndefined(Cause.failureOption(cause));
          return {
            report: {
              ...base,
              status: "failed",
              detail: failure?.message ?? describeCause(Cause.squash(cause)),
              count: 0,
              durationMs,
              ...(failure?.hint ? { hint: failure.hint } : {}),
            },
            value: [],
          };
        }),
      ),
    );
  });
export const attempt = <A>(
  source: string,
  run: (signal: AbortSignal) => Promise<A>,
  hint?: string,
) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      cause instanceof SourceError
        ? cause
        : new SourceError({
            source,
            message: describeCause(cause),
            cause,
            ...(hint ? { hint } : {}),
          }),
  });
