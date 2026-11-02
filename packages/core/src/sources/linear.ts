import { HttpClient } from "@effect/platform";
import { Effect } from "effect";
import { type Activity, type DateWindow, type OpenItem, inWindow } from "../domain/activity";
import { SourceError } from "../errors";
import { jsonClient } from "../util/http";
import { type Source, detected, notDetected } from "./source";
const API = "https://api.linear.app/graphql";
interface IssueNode {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly creator?: {
    readonly isMe: boolean;
  } | null;
  readonly state: {
    readonly name: string;
    readonly type: string;
  };
  readonly team: {
    readonly key: string;
    readonly name: string;
  };
  readonly project?: {
    readonly name: string;
  } | null;
}
const FIELDS = `id identifier title url createdAt updatedAt startedAt completedAt
  creator { isMe } state { name type } team { key name } project { name }`;
const WINDOW_QUERY = `query($since: DateTimeOrDuration!) {
  viewer {
    assignedIssues(first: 100, filter: { updatedAt: { gte: $since } }) { nodes { ${FIELDS} } }
    createdIssues(first: 50, filter: { createdAt: { gte: $since } }) { nodes { ${FIELDS} } }
  }
}`;
const OPEN_QUERY = `query {
  viewer {
    assignedIssues(first: 100, filter: { state: { type: { in: ["started", "unstarted"] } } }) { nodes { ${FIELDS} } }
  }
}`;
export const makeLinearSource = (opts: { readonly apiKey?: string }) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const apiKey = opts.apiKey ?? process.env.LINEAR_API_KEY;
    const graphql = <T>(query: string, variables: Record<string, string> = {}) =>
      Effect.gen(function* () {
        if (!apiKey)
          return yield* new SourceError({ source: "linear", message: "no Linear API key" });
        const client = yield* jsonClient("linear", { authorization: apiKey }).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        const res = (yield* client.post(API, { query, variables })) as {
          data?: T;
          errors?: {
            message: string;
          }[];
        };
        if (!res.data) {
          return yield* new SourceError({
            source: "linear",
            message: res.errors?.map((e) => e.message).join("; ") ?? "empty response",
          });
        }
        return res.data;
      });
    const project = (n: IssueNode) => n.project?.name ?? n.team.name;
    const activities = (window: DateWindow) =>
      Effect.gen(function* () {
        const data = yield* graphql<{
          viewer: {
            assignedIssues: {
              nodes: IssueNode[];
            };
            createdIssues: {
              nodes: IssueNode[];
            };
          };
        }>(WINDOW_QUERY, { since: window.start.toISOString() });
        const out = new Map<string, Activity>();
        const add = (n: IssueNode, action: string, at: string | null | undefined) => {
          if (!at || !inWindow(new Date(at), window)) return;
          const id = `linear:${action}:${n.id}`;
          out.set(id, {
            id,
            source: "linear",
            type: "issue",
            timestamp: new Date(at),
            title: n.title,
            url: n.url,
            project: project(n),
            metadata: { ref: n.identifier, action, state: n.state.name, team: n.team.key },
          });
        };
        for (const n of data.viewer.assignedIssues.nodes) {
          add(n, "completed", n.completedAt);
          add(n, "started", n.startedAt);
        }
        for (const n of data.viewer.createdIssues.nodes) add(n, "created", n.createdAt);
        return [...out.values()];
      });
    const openItems = Effect.map(
      graphql<{
        viewer: {
          assignedIssues: {
            nodes: IssueNode[];
          };
        };
      }>(OPEN_QUERY),
      (data) =>
        data.viewer.assignedIssues.nodes.map((n): OpenItem => ({
          id: `linear:open:${n.id}`,
          source: "linear",
          kind: "issue-assigned",
          title: n.title,
          ref: n.identifier,
          url: n.url,
          project: project(n),
          updatedAt: new Date(n.updatedAt),
          createdAt: new Date(n.createdAt),
          status: n.state.type === "started" ? `in progress (${n.state.name})` : n.state.name,
        })),
    );
    return {
      id: "linear",
      label: "Linear",
      detect: Effect.succeed(
        apiKey
          ? detected(opts.apiKey ? "API key from config" : "API key via $LINEAR_API_KEY")
          : notDetected("no API key ($LINEAR_API_KEY)"),
      ),
      activities,
      openItems,
    } satisfies Source;
  });
