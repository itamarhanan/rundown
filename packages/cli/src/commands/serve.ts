import { RundownConfig } from "@rundown/core";
import { defineCommand } from "citty";
import { styleText } from "node:util";
import { disposeRuntime, run } from "../runtime";
import { startServer, webRoot } from "../server";
import { openUrl } from "../util/system";
const VIEWS = ["morning", "yesterday", "today", "week", "history", "sources"] as const;
export default defineCommand({
  meta: {
    name: "serve",
    description: "Open the morning review screen in your browser (local web UI)",
  },
  args: {
    port: { type: "string", description: "Port (default: schedule.port, 4477)", valueHint: "port" },
    view: {
      type: "string",
      default: "morning",
      description: `View to open (${VIEWS.join(", ")})`,
      valueHint: "view",
    },
    open: {
      type: "boolean",
      default: true,
      description: "Open the browser",
      negativeDescription: "Don't open the browser",
    },
  },
  async run({ args }) {
    if (!(VIEWS as readonly string[]).includes(args.view)) {
      process.stderr.write(
        `${styleText("red", "✗")} unknown view "${args.view}" (expected: ${VIEWS.join(", ")})\n`,
      );
      process.exit(1);
    }
    const cfg = await run(RundownConfig);
    const port = args.port ? Number(args.port) : cfg.schedule.port;
    const server = await startServer(port).catch(async (e: Error) => {
      process.stderr.write(`${styleText("red", "✗")} ${e.message}\n`);
      await disposeRuntime();
      process.exit(1);
    });
    const url = `${server.url}/${args.view}`;
    process.stdout.write(
      `${styleText("cyan", "rundown")} serving ${styleText("bold", url)} (Ctrl-C to stop)\n`,
    );
    if (!webRoot())
      process.stdout.write(
        styleText("yellow", "web UI not built yet: run `pnpm build`; the API is up\n"),
      );
    if (args.open) openUrl(url);
    const stop = async () => {
      server.close();
      await disposeRuntime();
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  },
});
