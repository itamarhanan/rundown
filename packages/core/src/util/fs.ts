import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { cleanTitle } from "./title";
export const exists = (p: string): boolean => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};
export interface FoundFile {
  readonly path: string;
  readonly mtime: Date;
  readonly size: number;
}
export const filesModifiedSince = async (
  dir: string,
  since: Date,
  match: (name: string) => boolean,
  opts: {
    readonly maxDepth?: number;
    readonly skipDir?: (name: string) => boolean;
  } = {},
): Promise<FoundFile[]> => {
  const out: FoundFile[] = [];
  const maxDepth = opts.maxDepth ?? 6;
  const walk = async (d: string, depth: number): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (depth < maxDepth && !opts.skipDir?.(e.name)) await walk(p, depth + 1);
        } else if (e.isFile() && match(e.name)) {
          try {
            const st = await fsp.stat(p);
            if (st.mtime >= since) out.push({ path: p, mtime: st.mtime, size: st.size });
          } catch {}
        }
      }),
    );
  };
  await walk(dir, 0);
  return out;
};
export async function* readLines(file: string): AsyncGenerator<string> {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) if (line) yield line;
  } finally {
    rl.close();
  }
}
export const tryJson = <T = unknown>(text: string): T | undefined => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};
export const toTitle = (text: string, max?: number): string => cleanTitle(text, max);
