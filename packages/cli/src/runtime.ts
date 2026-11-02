import { RundownLive } from "@rundown/core";
import { Cause, type Effect, ManagedRuntime, Option } from "effect";
import { styleText } from "node:util";
const makeRuntime = () => ManagedRuntime.make(RundownLive());
type AppRuntime = ReturnType<typeof makeRuntime>;
export type AppServices = ManagedRuntime.ManagedRuntime.Context<AppRuntime>;
let runtime: AppRuntime | undefined;
export const getRuntime = (): AppRuntime => (runtime ??= makeRuntime());
export const disposeRuntime = async () => {
  const r = runtime;
  runtime = undefined;
  if (r) await r.dispose();
};
interface Tagged {
  readonly message?: string;
  readonly hint?: string;
}
export const reportFailure = (error: unknown) => {
  const e = (typeof error === "object" && error !== null ? error : {}) as Tagged;
  process.stderr.write(`${styleText(["red", "bold"], "✗")} ${e.message ?? String(error)}\n`);
  if (e.hint) process.stderr.write(`  ${styleText("dim", e.hint)}\n`);
};
export const runPromise = async <A>(effect: Effect.Effect<A, unknown, AppServices>): Promise<A> => {
  const exit = await getRuntime().runPromiseExit(effect);
  if (exit._tag === "Success") return exit.value;
  throw Option.getOrElse(Cause.failureOption(exit.cause), () => Cause.squash(exit.cause));
};
export const run = async <A>(effect: Effect.Effect<A, unknown, AppServices>): Promise<A> => {
  const exit = await getRuntime().runPromiseExit(effect);
  if (exit._tag === "Success") return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) reportFailure(failure.value);
  else if (Cause.isInterruptedOnly(exit.cause)) process.stderr.write("interrupted\n");
  else reportFailure(Cause.squash(exit.cause));
  await disposeRuntime();
  process.exit(1);
};
