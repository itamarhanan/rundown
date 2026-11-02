import { Effect } from "effect";
import * as os from "node:os";
import * as path from "node:path";
import { type Activity, type DateWindow, inWindow } from "../domain/activity";
import { exists, readLines } from "../util/fs";
import { type Source, attempt, detected, notDetected } from "./source";
export interface ShellSourceOptions {
  readonly historyFile?: string;
  readonly allow: readonly string[];
}
const candidates = () => [
  process.env.HISTFILE,
  path.join(os.homedir(), ".zsh_history"),
  path.join(os.homedir(), ".bash_history"),
  path.join(os.homedir(), ".local", "share", "fish", "fish_history"),
];
interface Entry {
  readonly at: Date;
  readonly command: string;
}
export async function* readHistory(file: string): AsyncGenerator<Entry> {
  let pendingTs: number | undefined;
  let fishCmd: string | undefined;
  for await (const line of readLines(file)) {
    const zsh = /^: (\d{9,11}):\d+;(.*)$/.exec(line);
    if (zsh) {
      yield { at: new Date(Number(zsh[1]) * 1000), command: zsh[2]!.trim() };
      continue;
    }
    const bashTs = /^#(\d{9,11})$/.exec(line);
    if (bashTs) {
      pendingTs = Number(bashTs[1]);
      continue;
    }
    const fish = /^- cmd: (.*)$/.exec(line);
    if (fish) {
      fishCmd = fish[1]!.trim();
      continue;
    }
    const when = /^\s+when: (\d{9,11})$/.exec(line);
    if (when && fishCmd) {
      yield { at: new Date(Number(when[1]) * 1000), command: fishCmd };
      fishCmd = undefined;
      continue;
    }
    if (pendingTs !== undefined) {
      yield { at: new Date(pendingTs * 1000), command: line.trim() };
      pendingTs = undefined;
    }
  }
}
export const makeShellSource = (opts: ShellSourceOptions): Source => {
  const file = () =>
    [opts.historyFile, ...candidates()].find((f): f is string => Boolean(f) && exists(f!));
  return {
    id: "shell",
    label: "Shell history",
    detect: Effect.sync(() => {
      const f = file();
      return f ? detected(f.replace(os.homedir(), "~")) : notDetected("no history file found");
    }),
    activities: (window: DateWindow) =>
      attempt("shell", async () => {
        const f = file();
        if (!f) return [];
        const out: Activity[] = [];
        let last = "";
        for await (const e of readHistory(f)) {
          if (!inWindow(e.at, window)) continue;
          if (!opts.allow.some((p) => e.command === p || e.command.startsWith(`${p} `))) continue;
          if (e.command === last) continue;
          last = e.command;
          out.push({
            id: `shell:${e.at.getTime()}:${e.command}`,
            source: "shell",
            type: "command",
            timestamp: e.at,
            title: e.command.length > 120 ? `${e.command.slice(0, 119)}…` : e.command,
            metadata: { command: e.command },
          });
        }
        return out;
      }),
  };
};
