import { HttpClient } from "@effect/platform";
import { Effect } from "effect";
import { type Activity, type DateWindow, type OpenItem, inWindow } from "../domain/activity";
import { SourceError } from "../errors";
import { exec } from "../util/exec";
import { jsonClient } from "../util/http";
import { projectFromRepoSlug } from "../util/project";
import { type Source, detected, notDetected } from "./source";
export interface GithubSourceOptions {
  readonly token?: string;
  readonly apiUrl?: string;
  readonly orgs?: readonly string[];
}
interface Token {
  readonly value: string;
  readonly via: string;
}
const resolveToken = (configured?: string): Effect.Effect<Token | undefined> => {
  if (configured) return Effect.succeed({ value: configured, via: "config" });
  for (const name of ["GITHUB_TOKEN", "GH_TOKEN"]) {
    const v = process.env[name];
    if (v) return Effect.succeed({ value: v, via: `$${name}` });
  }
  return exec("gh", ["auth", "token"], { timeoutMs: 5000 }).pipe(
    Effect.map((out) => (out.trim() ? { value: out.trim(), via: "gh CLI" } : undefined)),
    Effect.orElseSucceed(() => undefined),
  );
};
const graphqlUrl = (apiUrl: string) =>
  apiUrl.replace(/\/+$/, "").replace(/\/api\/v3$/, "/api") + "/graphql";
const ts = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
interface Repo {
  readonly nameWithOwner: string;
}
interface PrNode {
  readonly __typename?: "PullRequest";
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly isDraft?: boolean;
  readonly reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mergedAt?: string | null;
  readonly additions?: number;
  readonly deletions?: number;
  readonly repository: Repo;
  readonly reviews?: {
    readonly nodes: readonly {
      author: {
        login: string;
      } | null;
      state: string;
      submittedAt: string | null;
    }[];
  };
}
type Search<T> = {
  readonly nodes: readonly (T | Record<string, never>)[];
};
const PR = `id number title url isDraft reviewDecision createdAt updatedAt mergedAt additions deletions repository { nameWithOwner }`;
const ISSUE = `id number title url createdAt updatedAt repository { nameWithOwner }`;
const WINDOW_QUERY = `query($opened: String!, $merged: String!, $reviewed: String!, $issues: String!) {
  viewer { login }
  opened: search(query: $opened, type: ISSUE, first: 50) { nodes { ... on PullRequest { ${PR} } } }
  merged: search(query: $merged, type: ISSUE, first: 50) { nodes { ... on PullRequest { ${PR} } } }
  reviewed: search(query: $reviewed, type: ISSUE, first: 40) {
    nodes { ... on PullRequest { ${PR} reviews(last: 50) { nodes { author { login } state submittedAt } } } }
  }
  issues: search(query: $issues, type: ISSUE, first: 30) { nodes { ... on Issue { ${ISSUE} } } }
}`;
const OPEN_QUERY = `query($mine: String!, $review: String!, $assigned: String!) {
  mine: search(query: $mine, type: ISSUE, first: 50) { nodes { ... on PullRequest { ${PR} } } }
  review: search(query: $review, type: ISSUE, first: 50) { nodes { ... on PullRequest { ${PR} } } }
  assigned: search(query: $assigned, type: ISSUE, first: 50) { nodes { ... on Issue { ${ISSUE} } } }
}`;
const nodes = <
  T extends {
    id: string;
  },
>(
  s: Search<T> | undefined,
): T[] => (s?.nodes ?? []).filter((n): n is T => "id" in n);
const prStatus = (pr: PrNode): string | undefined => {
  if (pr.isDraft) return "draft";
  switch (pr.reviewDecision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes requested";
    case "REVIEW_REQUIRED":
      return "awaiting review";
    default:
      return undefined;
  }
};
const REVIEW_VERB: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};
export const makeGithubSource = (opts: GithubSourceOptions) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const token = yield* Effect.cached(resolveToken(opts.token));
    const scope = (opts.orgs ?? []).map((o) => `org:${o}`).join(" ");
    const q = (query: string) => `${query} ${scope} archived:false`.trim();
    const graphql = <T>(query: string, variables: Record<string, string>) =>
      Effect.gen(function* () {
        const t = yield* token;
        if (!t) {
          return yield* new SourceError({
            source: "github",
            message: "no GitHub token",
            hint: "run `gh auth login`, or export GITHUB_TOKEN",
          });
        }
        const client = yield* jsonClient("github", { authorization: `Bearer ${t.value}` }).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        const res = (yield* client.post(graphqlUrl(opts.apiUrl ?? "https://api.github.com"), {
          query,
          variables,
        })) as {
          data?: T;
          errors?: {
            message: string;
          }[];
        };
        if (res.errors?.length && !res.data) {
          return yield* new SourceError({
            source: "github",
            message: res.errors.map((e) => e.message).join("; "),
          });
        }
        return res.data as T;
      });
    const activities = (window: DateWindow) =>
      Effect.gen(function* () {
        const range = `${ts(window.start)}..${ts(window.end)}`;
        const data = yield* graphql<{
          viewer: {
            login: string;
          };
          opened: Search<PrNode>;
          merged: Search<PrNode>;
          reviewed: Search<PrNode>;
          issues: Search<PrNode>;
        }>(WINDOW_QUERY, {
          opened: q(`is:pr author:@me created:${range}`),
          merged: q(`is:pr author:@me merged:${range}`),
          reviewed: q(`is:pr reviewed-by:@me -author:@me updated:${range}`),
          issues: q(`is:issue author:@me created:${range}`),
        });
        const me = data.viewer.login;
        const pr = (
          n: PrNode,
          type: Activity["type"],
          at: string,
          extra: Record<string, unknown> = {},
        ): Activity => ({
          id: `github:${type}:${n.id}`,
          source: "github-pr",
          type,
          timestamp: new Date(at),
          title: n.title,
          url: n.url,
          project: projectFromRepoSlug(n.repository.nameWithOwner),
          metadata: {
            repo: n.repository.nameWithOwner,
            number: n.number,
            ref: `#${n.number}`,
            ...(n.additions !== undefined
              ? { additions: n.additions, deletions: n.deletions }
              : {}),
            ...extra,
          },
        });
        const out: Activity[] = [
          ...nodes(data.opened).map((n) =>
            pr(n, "pr-opened", n.createdAt, { draft: n.isDraft ?? false }),
          ),
          ...nodes(data.merged).flatMap((n) =>
            n.mergedAt ? [pr(n, "pr-merged", n.mergedAt)] : [],
          ),
          ...nodes(data.reviewed).flatMap((n) => {
            const mine = (n.reviews?.nodes ?? []).filter(
              (r) =>
                r.author?.login === me &&
                r.submittedAt &&
                inWindow(new Date(r.submittedAt), window),
            );
            if (mine.length === 0) return [];
            const rank = (s: string) => (s === "APPROVED" || s === "CHANGES_REQUESTED" ? 1 : 0);
            const best = [...mine].sort((a, b) => rank(b.state) - rank(a.state))[0]!;
            return [
              pr(n, "pr-reviewed", mine[mine.length - 1]!.submittedAt!, {
                review: REVIEW_VERB[best.state] ?? best.state.toLowerCase(),
                reviews: mine.length,
              }),
            ];
          }),
          ...nodes(data.issues).map((n) => ({
            ...pr(n, "issue", n.createdAt),
            id: `github:issue:${n.id}`,
            metadata: {
              repo: n.repository.nameWithOwner,
              number: n.number,
              ref: `#${n.number}`,
              action: "opened",
            },
          })),
        ];
        return out.filter((a) => inWindow(a.timestamp, window));
      });
    const openItems = Effect.gen(function* () {
      const data = yield* graphql<{
        mine: Search<PrNode>;
        review: Search<PrNode>;
        assigned: Search<PrNode>;
      }>(OPEN_QUERY, {
        mine: q("is:pr is:open author:@me"),
        review: q("is:pr is:open review-requested:@me"),
        assigned: q("is:issue is:open assignee:@me"),
      });
      const item = (n: PrNode, kind: OpenItem["kind"]): OpenItem => {
        const status = kind === "issue-assigned" ? undefined : prStatus(n);
        return {
          id: `github:${kind}:${n.id}`,
          source: "github",
          kind,
          title: n.title,
          ref: `${n.repository.nameWithOwner.split("/")[1]}#${n.number}`,
          url: n.url,
          project: projectFromRepoSlug(n.repository.nameWithOwner),
          updatedAt: new Date(n.updatedAt),
          createdAt: new Date(n.createdAt),
          ...(status ? { status } : {}),
        };
      };
      return [
        ...nodes(data.mine).map((n) => item(n, "pr-authored")),
        ...nodes(data.review).map((n) => item(n, "review-requested")),
        ...nodes(data.assigned).map((n) => item(n, "issue-assigned")),
      ];
    });
    return {
      id: "github",
      label: "GitHub",
      detect: Effect.map(token, (t) =>
        t
          ? detected(`token via ${t.via}`)
          : notDetected("no token (gh auth login, or $GITHUB_TOKEN)"),
      ),
      activities,
      openItems,
    } satisfies Source;
  });
