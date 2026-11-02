import { Effect } from "effect";
import { execFile, spawn } from "node:child_process";
import { ProcessError } from "../errors";
export interface ExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly input?: string;
  readonly maxBuffer?: number;
}
export const exec = (command: string, args: readonly string[], opts: ExecOptions = {}) =>
  Effect.async<string, ProcessError>((resume, signal) => {
    const child = execFile(
      command,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 30000,
        maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
        encoding: "utf8",
        signal,
        env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === "number" ? error.code : undefined;
          resume(
            Effect.fail(
              new ProcessError({
                command: [command, ...args].join(" "),
                message:
                  (error as NodeJS.ErrnoException).code === "ENOENT"
                    ? `${command}: not found`
                    : error.message,
                ...(code !== undefined ? { exitCode: code } : {}),
                stderr: String(stderr).trim(),
              }),
            ),
          );
        } else resume(Effect.succeed(stdout));
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
export const which = (command: string) =>
  exec(process.platform === "win32" ? "where" : "which", [command], { timeoutMs: 5000 }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
export const launchDetached = (command: string, args: readonly string[]) =>
  Effect.try({
    try: () => {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.unref();
    },
    catch: (e) => new ProcessError({ command, message: String(e) }),
  });
