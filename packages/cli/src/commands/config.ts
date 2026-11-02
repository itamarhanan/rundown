import { loadConfigFile, paths, providerEnvKey } from "@rundown/core";
import { defineCommand } from "citty";
import { Effect } from "effect";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { styleText } from "node:util";
import { reportFailure } from "../runtime";
const validate = async () => {
  const exit = await Effect.runPromiseExit(loadConfigFile());
  if (exit._tag === "Success") {
    process.stdout.write(`${styleText("green", "✓")} config is valid\n`);
    return true;
  }
  reportFailure(exit.cause._tag === "Fail" ? exit.cause.error : exit.cause);
  return false;
};
export default defineCommand({
  meta: { name: "config", description: "Show, edit, or validate your config" },
  args: {
    edit: {
      type: "boolean",
      alias: "e",
      description: "Open config.yaml in $EDITOR, then validate it",
    },
    path: { type: "boolean", description: "Print the config file path" },
  },
  async run({ args }) {
    const file = paths.config;
    if (args.path) {
      process.stdout.write(`${file}\n`);
      return;
    }
    if (!fs.existsSync(file)) {
      process.stderr.write(
        `no config at ${file}\n  run ${styleText("cyan", "rundown init")} to create one\n`,
      );
      process.exitCode = 1;
      return;
    }
    if (args.edit) {
      const editor = process.env.VISUAL || process.env.EDITOR || "vi";
      await new Promise((resolve) =>
        spawn(`${editor} "${file}"`, { stdio: "inherit", shell: true }).on("close", resolve),
      );
      if (!(await validate())) process.exitCode = 1;
      return;
    }
    process.stdout.write(`${styleText("gray", `# ${file}`)}\n\n${fs.readFileSync(file, "utf8")}\n`);
    const keys = Object.values(providerEnvKey).filter(Boolean) as string[];
    const set = keys.filter((k) => process.env[k]);
    process.stdout.write(
      styleText(
        "gray",
        `API keys come from your environment. Set here: ${set.length ? set.join(", ") : "none"}.\n`,
      ),
    );
    if (!(await validate())) process.exitCode = 1;
  },
});
