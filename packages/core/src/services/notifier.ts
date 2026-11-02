import { Context, Effect, Layer } from "effect";
import { exec, which } from "../util/exec";
export interface Notification {
  readonly title: string;
  readonly body: string;
  readonly action?: string;
}
const escapeAppleScript = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const escapePs = (s: string) => s.replace(/'/g, "''");
export class Notifier extends Context.Tag("rundown/Notifier")<
  Notifier,
  {
    readonly notify: (n: Notification) => Effect.Effect<boolean>;
  }
>() {
  static readonly Live = Layer.succeed(Notifier, {
    notify: (n) =>
      Effect.gen(function* () {
        switch (process.platform) {
          case "linux": {
            if (!(yield* which("notify-send"))) return false;
            const args = ["--app-name=Rundown", "--icon=x-office-calendar", n.title, n.body];
            if (!n.action) {
              yield* exec("notify-send", args).pipe(Effect.ignore);
              return false;
            }
            const out = yield* exec(
              "notify-send",
              [`--action=open=${n.action}`, "--wait", ...args],
              {
                timeoutMs: 15 * 60000,
              },
            ).pipe(Effect.orElseSucceed(() => ""));
            return out.trim() === "open";
          }
          case "darwin":
            yield* exec("osascript", [
              "-e",
              `display notification "${escapeAppleScript(n.body)}" with title "${escapeAppleScript(n.title)}"`,
            ]).pipe(Effect.ignore);
            return false;
          case "win32":
            yield* exec("powershell", [
              "-NoProfile",
              "-Command",
              `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; ` +
                `$n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; ` +
                `$n.ShowBalloonTip(10000, '${escapePs(n.title)}', '${escapePs(n.body)}', 'Info'); Start-Sleep 10`,
            ]).pipe(Effect.ignore);
            return false;
          default:
            return false;
        }
      }),
  });
}
