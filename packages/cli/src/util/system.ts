import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const CLIPBOARDS: Record<string, readonly (readonly string[])[]> = {
  darwin: [["pbcopy"]],
  win32: [["clip"]],
  linux: [
    ["wl-copy"],
    ["xclip", "-selection", "clipboard"],
    ["xsel", "--clipboard", "--input"],
    ["clip.exe"],
  ],
};
const pipeTo = (cmd: readonly string[], input: string) =>
  new Promise<boolean>((resolve) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.end(input);
  });
export const copyToClipboard = async (text: string): Promise<string | undefined> => {
  for (const cmd of CLIPBOARDS[process.platform] ?? []) {
    if (await pipeTo(cmd, text)) return cmd[0];
  }
  return undefined;
};
export const editInEditor = async (text: string, name = "standup.md"): Promise<string> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  const editor =
    process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(`${editor} "${file}"`, { stdio: "inherit", shell: true });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`${editor} exited with ${code}`)),
      );
    });
    return fs.readFileSync(file, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
export const openUrl = (url: string) => {
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const child = spawn(cmd!, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
};
export const isInteractive = () => Boolean(process.stdout.isTTY && process.stdin.isTTY);
const onPath = (cmd: string) =>
  new Promise<boolean>((resolve) => {
    const child = spawn(process.platform === "win32" ? "where" : "which", [cmd], {
      stdio: "ignore",
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
const LINUX_TERMINALS: readonly (readonly [string, readonly string[]])[] = [
  ["x-terminal-emulator", ["-e"]],
  ["gnome-terminal", ["--"]],
  ["kitty", []],
  ["alacritty", ["-e"]],
  ["wezterm", ["start", "--"]],
  ["ghostty", ["-e"]],
  ["konsole", ["-e"]],
  ["xfce4-terminal", ["-x"]],
  ["xterm", ["-e"]],
];
const shellQuote = (s: string) =>
  /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
const detach = (cmd: string, args: readonly string[]) =>
  new Promise<boolean>((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
export const openTerminal = async (command: readonly string[]): Promise<string | undefined> => {
  const line = command.map(shellQuote).join(" ");
  if (process.platform === "darwin") {
    const script = `tell application "Terminal" to do script "${line.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    return (await detach("osascript", [
      "-e",
      script,
      "-e",
      'tell application "Terminal" to activate',
    ]))
      ? "Terminal"
      : undefined;
  }
  if (process.platform === "win32") {
    return (await detach("cmd", ["/c", "start", "", "cmd", "/k", ...command])) ? "cmd" : undefined;
  }
  const preferred = process.env.TERMINAL;
  const candidates = preferred
    ? [[preferred, ["-e"]] as const, ...LINUX_TERMINALS]
    : LINUX_TERMINALS;
  for (const [term, flag] of candidates) {
    if ((await onPath(term)) && (await detach(term, [...flag, ...command]))) return term;
  }
  return undefined;
};
