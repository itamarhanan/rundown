import { HttpClient, HttpClientRequest, type HttpClientError } from "@effect/platform";
import { Duration, Effect, Schedule } from "effect";
import { SourceError } from "../errors";
export interface JsonClient {
  readonly get: (url: string) => Effect.Effect<unknown, SourceError>;
  readonly post: (url: string, body: unknown) => Effect.Effect<unknown, SourceError>;
}
const statusHint = (source: string, status: number): string | undefined => {
  if (status === 401) return `${source} rejected the token. Check it hasn't expired.`;
  if (status === 403) return `${source} denied access or rate-limited the request.`;
  return undefined;
};
export const jsonClient = (source: string, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.setHeaders({ "user-agent": "rundown", ...headers })),
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ times: 2, schedule: Schedule.exponential(Duration.millis(300)) }),
    );
    const toError = (e: HttpClientError.HttpClientError) => {
      const status = e._tag === "ResponseError" ? e.response.status : undefined;
      const hint = status ? statusHint(source, status) : undefined;
      return new SourceError({
        source,
        message: status ? `HTTP ${status} from ${e.request.url.split("?")[0]}` : e.message,
        cause: e,
        ...(hint ? { hint } : {}),
      });
    };
    const run = (req: HttpClientRequest.HttpClientRequest) =>
      client.execute(req).pipe(
        Effect.flatMap((res) => res.json),
        Effect.scoped,
        Effect.mapError(toError),
      );
    return {
      get: (url) => run(HttpClientRequest.get(url)),
      post: (url, body) => run(HttpClientRequest.bodyUnsafeJson(HttpClientRequest.post(url), body)),
    } satisfies JsonClient;
  });
