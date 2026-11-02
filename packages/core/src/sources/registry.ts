import { HttpClient } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import { RundownConfig } from "../config/load";
import { makeCalendarSource } from "./calendar";
import { makeGitSource } from "./git";
import { makeGithubSource } from "./github";
import { makeLinearSource } from "./linear";
import { makeShellSource } from "./shell";
import type { Source } from "./source";
export class Sources extends Context.Tag("rundown/Sources")<
  Sources,
  {
    readonly all: readonly Source[];
  }
>() {
  static readonly Live = Layer.effect(
    Sources,
    Effect.gen(function* () {
      const cfg = yield* RundownConfig;
      const s = cfg.sources;
      const http = yield* HttpClient.HttpClient;
      const withHttp = <A, E>(eff: Effect.Effect<A, E, HttpClient.HttpClient>) =>
        Effect.provideService(eff, HttpClient.HttpClient, http);
      const all: Source[] = [];
      if (s.git.enabled) all.push(makeGitSource(s.git));
      if (s.github.enabled) {
        all.push(
          yield* withHttp(
            makeGithubSource({
              apiUrl: s.github.apiUrl,
              orgs: s.github.orgs,
              ...(s.github.token ? { token: s.github.token } : {}),
            }),
          ),
        );
      }
      if (s.linear.enabled) {
        all.push(
          yield* withHttp(makeLinearSource(s.linear.apiKey ? { apiKey: s.linear.apiKey } : {})),
        );
      }
      if (s.calendar.enabled) {
        all.push(
          yield* withHttp(
            makeCalendarSource({
              feeds: s.calendar.ics,
              timeZone: cfg.user.timezone,
              hideDeclined: s.calendar.hideDeclined,
              ...(cfg.user.email ? { email: cfg.user.email } : {}),
            }),
          ),
        );
      }
      if (s.shell.enabled) {
        all.push(
          makeShellSource({
            allow: s.shell.allow,
            ...(s.shell.historyFile ? { historyFile: s.shell.historyFile } : {}),
          }),
        );
      }
      return { all };
    }),
  );
  static readonly layer = (all: readonly Source[]) => Layer.succeed(Sources, { all });
}
