import { Effect } from "effect";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type DateWindow, inWindow } from "../domain/activity";
import { attempt, detected, notDetected } from "../sources/source";
import { exists, filesModifiedSince, readLines, toTitle, tryJson } from "../util/fs";
import { cleanName } from "../util/title";
import type { AgentAdapter, AgentSession } from "./agent";
const FLAVOURS = ["Code", "Code - Insiders", "VSCodium"];
export const vscodeUserDirs = (home = os.homedir()): string[] =>
  FLAVOURS.flatMap((f) => [
    path.join(home, ".config", f, "User"),
    path.join(home, "Library", "Application Support", f, "User"),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, f, "User")] : []),
  ]).filter(exists);
interface ChatRequest {
  timestamp?: number;
  modelId?: string;
  message?: {
    text?: string;
  };
  agent?: {
    extensionId?: {
      value?: string;
    };
  };
}
interface ChatState {
  sessionId?: string;
  customTitle?: string;
  responderUsername?: string;
  requests?: ChatRequest[];
}
export const readChatState = async (file: string): Promise<ChatState | undefined> => {
  if (file.endsWith(".json")) return tryJson<ChatState>(await fsp.readFile(file, "utf8"));
  let state: ChatState | undefined;
  for await (const line of readLines(file)) {
    const op = tryJson<{
      kind: number;
      k?: (string | number)[];
      v?: unknown;
    }>(line);
    if (!op) continue;
    if (op.kind === 0)
      state = { ...(op.v as ChatState), requests: [...((op.v as ChatState).requests ?? [])] };
    else if (state && op.k?.length === 1) {
      const key = op.k[0];
      if (op.kind === 1 && key === "customTitle") state.customTitle = op.v as string;
      if (op.kind === 2 && key === "requests")
        state.requests!.push(...((op.v as ChatRequest[]) ?? []));
    }
  }
  return state;
};
const workspaceFolder = async (workspaceDir: string): Promise<string | undefined> => {
  const j = tryJson<{
    folder?: string;
  }>(await fsp.readFile(path.join(workspaceDir, "workspace.json"), "utf8").catch(() => ""));
  if (!j?.folder?.startsWith("file://")) return undefined;
  try {
    return fileURLToPath(j.folder);
  } catch {
    return undefined;
  }
};
const assistantName = (r: ChatRequest | undefined, responder?: string) => {
  const ext = r?.agent?.extensionId?.value?.toLowerCase();
  if (ext?.includes("copilot") || responder?.toLowerCase().includes("copilot")) return "copilot";
  return (
    ext
      ?.split(".")
      .pop()
      ?.replace(/-chat$/, "") ?? "vscode"
  );
};
export const sessionFromChat = (
  state: ChatState,
  file: string,
  window: DateWindow,
  cwd: string | undefined,
): AgentSession | undefined => {
  const inside = (state.requests ?? []).filter(
    (r) => r.timestamp && inWindow(new Date(r.timestamp), window),
  );
  if (inside.length === 0) return undefined;
  const times = inside.map((r) => r.timestamp!);
  const firstText = state.requests?.find((r) => r.message?.text)?.message?.text;
  const assistant = assistantName(inside[0], state.responderUsername);
  return {
    agent: "vscode",
    id: state.sessionId ?? path.basename(file).replace(/\.jsonl?$/, ""),
    title:
      (state.customTitle && cleanName(state.customTitle)) ||
      (firstText && toTitle(firstText)) ||
      `${assistant} chat`,
    start: new Date(Math.min(...times)),
    end: new Date(Math.max(...times)),
    prompts: inside.length,
    ...(cwd ? { cwd } : {}),
    ...(inside[0]?.modelId ? { model: inside[0].modelId } : {}),
  };
};
export const makeVsCodeAdapter = (
  opts: {
    readonly userDirs?: readonly string[];
  } = {},
): AgentAdapter => {
  const dirs = () => opts.userDirs ?? vscodeUserDirs();
  return {
    name: "vscode",
    label: "VS Code chat",
    detect: Effect.sync(() => {
      const found = dirs().filter((d) => exists(path.join(d, "workspaceStorage")));
      return found.length
        ? detected(found.map((d) => d.replace(os.homedir(), "~")).join(", "))
        : notDetected("no VS Code user dir found");
    }),
    fetchSessions: (window) =>
      attempt("agent:vscode", async () => {
        const out: AgentSession[] = [];
        for (const userDir of dirs()) {
          const storage = path.join(userDir, "workspaceStorage");
          const workspaces = await fsp.readdir(storage).catch(() => [] as string[]);
          const targets = [
            ...workspaces.map((w) => ({
              dir: path.join(storage, w, "chatSessions"),
              ws: path.join(storage, w),
            })),
            { dir: path.join(userDir, "globalStorage", "emptyWindowChatSessions"), ws: undefined },
          ];
          const perDir = await Promise.all(
            targets.map(async ({ dir, ws }) => {
              const files = await filesModifiedSince(
                dir,
                window.start,
                (n) => /\.jsonl?$/.test(n),
                { maxDepth: 0 },
              );
              if (files.length === 0) return [];
              const cwd = ws ? await workspaceFolder(ws) : undefined;
              const sessions = await Promise.all(
                files.map(async (f) => {
                  const state = await readChatState(f.path);
                  return state ? sessionFromChat(state, f.path, window, cwd) : undefined;
                }),
              );
              return sessions.filter((s): s is AgentSession => s !== undefined);
            }),
          );
          out.push(...perDir.flat());
        }
        return out;
      }),
  };
};
