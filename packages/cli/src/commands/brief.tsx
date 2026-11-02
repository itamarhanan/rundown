import { type BriefKind, type BriefOptions, Briefs } from "@rundown/core";
import { defineCommand } from "citty";
import { Effect } from "effect";
import { render, renderToString } from "ink";
import { styleText } from "node:util";
import { disposeRuntime, run } from "../runtime";
import { App } from "../tui/App";
import { BriefView } from "../tui/BriefView";
import { contentWidth } from "../tui/theme";
import { copyToClipboard, isInteractive } from "../util/system";
const DESCRIPTIONS: Record<BriefKind, string> = {
  yesterday: "Standup summary since your last workday",
  today: "Today's meetings, PRs to ship, reviews owed, and issues",
  morning: "Morning brief: yesterday's recap plus today's plan",
  week: "Weekly summary",
};
export const briefCommand = (kind: BriefKind) =>
  defineCommand({
    meta: { name: kind, description: DESCRIPTIONS[kind] },
    args: {
      ...(kind === "week"
        ? {
            last: {
              type: "boolean",
              description: "Summarize last week instead of this one",
            },
          }
        : {
            date: {
              type: "string",
              description: "Report on a specific day (YYYY-MM-DD)",
              valueHint: "date",
            },
          }),
      refresh: {
        type: "boolean",
        alias: "r",
        description: "Regenerate the summary, ignoring the cache and your edits",
      },
      llm: {
        type: "boolean",
        default: true,
        description: "Write the summary with your LLM",
        negativeDescription: "Use the plain digest, no LLM call",
      },
      copy: {
        type: "boolean",
        alias: "c",
        description: "Copy the standup to the clipboard",
      },
      plain: {
        type: "boolean",
        alias: "p",
        description: "Print only the standup text (Markdown), for pasting or piping",
      },
      json: { type: "boolean", description: "Print the full brief as JSON" },
      details: {
        type: "boolean",
        alias: "d",
        description: "List every activity under each project",
      },
      sources: {
        type: "boolean",
        alias: "s",
        description: "Show per-source status and timings",
      },
      interactive: {
        type: "boolean",
        alias: "i",
        default: true,
        description:
          "After the brief, wait for keys: copy, edit, regenerate, details, sources, open web",
        negativeDescription: "Print the brief and exit",
      },
    },
    async run({ args }) {
      const options: Omit<BriefOptions, "onReport"> = {
        refresh: Boolean(args.refresh),
        llm: args.llm !== false,
        ...("date" in args && args.date ? { date: String(args.date) } : {}),
        ...("last" in args && args.last ? { weekOffset: -1 } : {}),
      };
      const view = {
        details: Boolean(args.details),
        sources: Boolean(args.sources),
      };
      if (args.json || args.plain || !process.stdout.isTTY) {
        const brief = await run(Effect.flatMap(Briefs, (b) => b.build(kind, options)));
        if (args.json) process.stdout.write(`${JSON.stringify(brief, null, 2)}\n`);
        else if (args.plain) process.stdout.write(`${brief.summary.text}\n`);
        else {
          const columns = contentWidth(Number(process.env.COLUMNS) || 80);
          process.stdout.write(
            `${renderToString(<BriefView brief={brief} view={view} />, { columns })}\n`,
          );
        }
        if (args.plain && brief.summary.note)
          process.stderr.write(`${styleText("yellow", "note:")} ${brief.summary.note}\n`);
        if (args.copy) {
          const tool = await copyToClipboard(brief.summary.text);
          process.stderr.write(
            tool
              ? `${styleText("green", "✓")} copied the standup via ${tool}\n`
              : `${styleText("red", "!")} couldn't copy: no clipboard tool worked (install wl-clipboard or xclip)\n`,
          );
        }
        await disposeRuntime();
        return;
      }
      const app = render(
        <App
          kind={kind}
          options={options}
          interactive={args.interactive !== false && isInteractive()}
          initial={view}
          copy={Boolean(args.copy)}
        />,
      );
      try {
        await app.waitUntilExit();
      } catch {
        process.exitCode = 1;
      } finally {
        await disposeRuntime();
      }
    },
  });
