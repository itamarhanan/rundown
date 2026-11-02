import * as path from "node:path";
import { exists } from "./fs";
const rootCache = new Map<string, string | undefined>();
export const repoRoot = (dir: string): string | undefined => {
  if (rootCache.has(dir)) return rootCache.get(dir);
  let cur = path.resolve(dir);
  let found: string | undefined;
  for (;;) {
    if (exists(path.join(cur, ".git"))) {
      found = cur;
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  rootCache.set(dir, found);
  return found;
};
export const projectFromPath = (dir: string | undefined): string | undefined => {
  if (!dir) return undefined;
  return path.basename(repoRoot(dir) ?? dir) || undefined;
};
export const projectFromRepoSlug = (slug: string | undefined): string | undefined =>
  slug
    ?.replace(/\.git$/, "")
    .split("/")
    .filter(Boolean)
    .pop();
export const projectKey = (project: string | undefined): string => (project ?? "").toLowerCase();
