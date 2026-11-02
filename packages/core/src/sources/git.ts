import { Effect } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Activity, DateWindow } from "../domain/activity";
import { SourceError } from "../errors";
import { exec } from "../util/exec";
import { exists } from "../util/fs";
import { projectFromRepoSlug } from "../util/project";
import { type Source, detected, notDetected } from "./source";
export interface GitSourceOptions {
  readonly repos: readonly string[];
  readonly authors: readonly string[];
  readonly depth?: number;
}
const SKIP = new Set(["node_modules", "vendor", "dist", "build", "target", ".venv", "venv"]);
export const discoverRepos = (roots: readonly string[], depth = 3): string[] => {
  const found = new Set<string>();
  const walk = (dir: string, level: number) => {
    if (exists(path.join(dir, ".git"))) {
      found.add(dir);
      return;
    }
    if (level >= depth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
        walk(path.join(dir, e.name), level + 1);
    }
  };
  for (const root of roots) walk(path.resolve(root), 0);
  return [...found].sort();
};
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RS = "\x1e";
const US = "\x1f";
const FORMAT = `--pretty=format:${RS}%H${US}%an${US}%ae${US}%aI${US}%S${US}%s`;
interface ParsedCommit {
  readonly hash: string;
  readonly author: string;
  readonly email: string;
  readonly date: Date;
  readonly ref: string;
  readonly subject: string;
  readonly files: {
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }[];
}
export const parseGitLog = (raw: string): ParsedCommit[] =>
  raw
    .split(RS)
    .filter((block) => block.trim())
    .flatMap((block) => {
      const [header = "", ...rest] = block.split("\n");
      const [hash, author = "", email = "", date = "", ref = "", subject = ""] = header.split(US);
      if (!hash || !/^[0-9a-f]{7,64}$/.test(hash)) return [];
      const files = rest.flatMap((line) => {
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
        return m
          ? [
              {
                path: m[3]!,
                additions: m[1] === "-" ? 0 : Number(m[1]),
                deletions: m[2] === "-" ? 0 : Number(m[2]),
              },
            ]
          : [];
      });
      return [{ hash, author, email, date: new Date(date), ref, subject, files }];
    });
const branchOf = (ref: string) =>
  ref.replace(/^refs\/(heads|remotes\/[^/]+)\//, "").replace(/^refs\/tags\//, "tag:") || undefined;
const remoteSlug = (repo: string) =>
  exec("git", ["-C", repo, "remote", "get-url", "origin"], { timeoutMs: 5000 }).pipe(
    Effect.map((url) => {
      const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\s*$/.exec(url.trim());
      return m?.[1];
    }),
    Effect.orElseSucceed(() => undefined),
  );
const logRepo = (repo: string, window: DateWindow, authors: readonly string[]) =>
  Effect.gen(function* () {
    const args = [
      "-C",
      repo,
      "log",
      "--all",
      "--no-merges",
      "--source",
      `--since=${window.start.toISOString()}`,
      `--until=${window.end.toISOString()}`,
      FORMAT,
      "--numstat",
      ...(authors.length
        ? ["--regexp-ignore-case", ...authors.map((a) => `--author=${escapeRegex(a)}`)]
        : []),
    ];
    const [raw, slug] = yield* Effect.all(
      [exec("git", args, { timeoutMs: 20000 }), remoteSlug(repo)],
      {
        concurrency: 2,
      },
    );
    const project = projectFromRepoSlug(slug) ?? path.basename(repo);
    return parseGitLog(raw)
      .filter((c) => c.date >= window.start && c.date < window.end)
      .map((c): Activity => {
        const additions = c.files.reduce((n, f) => n + f.additions, 0);
        const deletions = c.files.reduce((n, f) => n + f.deletions, 0);
        const branch = branchOf(c.ref);
        return {
          id: `git:${c.hash}`,
          source: "git",
          type: "commit",
          timestamp: c.date,
          title: c.subject,
          description: `${c.files.length} files, +${additions}/-${deletions}`,
          project,
          metadata: {
            hash: c.hash,
            repo,
            ...(slug ? { slug } : {}),
            ...(branch ? { branch } : {}),
            author: c.author,
            email: c.email,
            files: c.files.length,
            additions,
            deletions,
            ...(/\(aider\)$/.test(c.author) ? { agent: "aider" } : {}),
          },
        };
      });
  }).pipe(
    Effect.mapError(
      (e) =>
        new SourceError({
          source: "git",
          message: `${path.basename(repo)}: ${e.message}`,
          cause: e,
        }),
    ),
  );
export const makeGitSource = (opts: GitSourceOptions): Source => {
  let repos: string[] | undefined;
  const resolve = () => (repos ??= discoverRepos(opts.repos, opts.depth));
  return {
    id: "git",
    label: "Git",
    detect: Effect.sync(() => {
      if (opts.repos.length === 0) return notDetected("no repos configured (sources.git.repos)");
      const n = resolve().length;
      return n > 0
        ? detected(`${n} repos`)
        : notDetected(`no git repos found under ${opts.repos.join(", ")}`);
    }),
    activities: (window) =>
      Effect.gen(function* () {
        const results = yield* Effect.forEach(
          resolve(),
          (repo) => logRepo(repo, window, opts.authors).pipe(Effect.either),
          { concurrency: 8 },
        );
        const ok = results.flatMap((r) => (r._tag === "Right" ? [r.right] : []));
        const failed = results.flatMap((r) => (r._tag === "Left" ? [r.left] : []));
        if (ok.length === 0 && failed.length > 0) return yield* failed[0]!;
        const seen = new Set<string>();
        return ok.flat().filter((a) => !seen.has(a.id) && seen.add(a.id));
      }),
  };
};
