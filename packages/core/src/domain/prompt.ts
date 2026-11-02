import type { Activity } from "./activity";
import type { Brief } from "./brief";
import { tidyTitle } from "../util/title";
import { type Calendar, formatDay, formatTime } from "./window";
export interface PromptOptions {
  readonly maxWords: number;
  readonly instructions?: string;
}
const SYSTEM = `You write a developer's daily standup update from their raw activity log.

Rules:
- First person, past tense for done work, plain and specific. No filler, no praise, no emojis.
- Group done work by project. Lead with outcomes (merged, shipped, reviewed, fixed), then work in progress.
- Collapse many small commits into what they achieved. Cite PR/issue refs (#123, ENG-42) when given.
- Agent sessions are work done with an AI coding agent: describe the task, not the tool.
- "Today" lists the plan: meetings worth mentioning, PRs to ship, reviews owed, issues in progress.
  If nothing is scheduled, infer the natural next step from yesterday's unfinished work.
- "Blockers": only those listed under BLOCKERS, rephrased. If none are listed, write "None".
- Never invent work, numbers, or people that are not in the log.
- Output Markdown with exactly these bold headers in order: **Yesterday**, **Today**, **Blockers**.
  Bullets under each. No preamble, no closing line.`;
const WEEK_SYSTEM = `You write a developer's weekly summary from their raw activity log.

Rules:
- First person, past tense, plain and specific. No filler, no praise, no emojis.
- Group by project, most significant first. Lead with outcomes: merged PRs, shipped features, fixes, reviews.
- Collapse commits into what they achieved. Cite PR/issue refs when given.
- Close with a short **Next week** section inferred only from open work in the log.
- Never invent work, numbers, or people that are not in the log.
- Output Markdown with bold headers **This week** and **Next week**, bullets under each. No preamble.`;
const MAX_PER_PROJECT = 25;
const line = (a: Activity): string => {
  const m = a.metadata;
  const ref = typeof m.ref === "string" ? `${m.ref} ` : "";
  switch (a.type) {
    case "commit":
      return `commit: ${a.title}${m.branch ? ` [${String(m.branch)}]` : ""}`;
    case "pr-opened":
      return `opened PR ${ref}${a.title}${m.draft ? " (draft)" : ""}`;
    case "pr-merged":
      return `merged PR ${ref}${a.title}`;
    case "pr-reviewed":
      return `reviewed PR ${ref}${a.title}${m.review ? ` (${String(m.review)})` : ""}`;
    case "issue":
      return `${String(m.action ?? "updated")} issue ${ref}${a.title}`;
    case "agent-session":
      return `agent session (${String(m.agent)}, ${String(m.prompts ?? 0)} prompts): ${tidyTitle(a.title)}`;
    case "command":
      return `ran: ${a.title}`;
    case "meeting":
      return `meeting: ${a.title}`;
  }
};
export const buildPrompt = (brief: Brief, cal: Calendar, opts: PromptOptions) => {
  const out: string[] = [`DEVELOPER: ${brief.user.name}`];
  const { recap, plan } = brief;
  if (recap) {
    out.push("", `DONE (${recap.window.label}):`);
    if (recap.projects.length === 0) out.push("(no activity logged)");
    for (const g of recap.projects) {
      out.push(
        `## ${g.project} (+${g.additions}/-${g.deletions} lines across ${g.commits} commits)`,
      );
      const items = g.activities.slice(-MAX_PER_PROJECT).map((a) => `- ${line(a)}`);
      if (g.activities.length > MAX_PER_PROJECT)
        out.push(`- …${g.activities.length - MAX_PER_PROJECT} earlier items`);
      out.push(...items);
    }
    const meetings = recap.meetings.filter((m) => !m.metadata.allDay);
    if (meetings.length) {
      out.push(
        "## meetings",
        ...meetings.map(
          (m) => `- ${brief.kind === "week" ? `${formatDay(cal, m.timestamp)} ` : ""}${m.title}`,
        ),
      );
    }
    if (recap.commands.length)
      out.push("## notable commands", ...recap.commands.slice(0, 15).map((c) => `- ${line(c)}`));
  }
  if (plan) {
    out.push("", `TODAY (${plan.window.label}):`);
    const meetings = plan.meetings.filter((m) => !m.metadata.allDay);
    out.push(
      ...(meetings.length
        ? meetings.map((m) => `- ${formatTime(cal, m.timestamp)} meeting: ${m.title}`)
        : ["- no meetings"]),
      ...plan.authored.map(
        (p) => `- my open PR ${p.ref} ${p.title}${p.status ? ` (${p.status})` : ""}`,
      ),
      ...plan.reviews.map((p) => `- review requested: ${p.ref} ${p.title}`),
      ...plan.issues.map(
        (i) => `- assigned issue ${i.ref} ${i.title}${i.status ? ` (${i.status})` : ""}`,
      ),
    );
  }
  if (brief.kind !== "week") {
    out.push(
      "",
      "BLOCKERS:",
      ...(brief.blockers.length ? brief.blockers.map((b) => `- ${b}`) : ["- none"]),
    );
  }
  const style = [
    `Keep it under ${opts.maxWords} words.`,
    ...(opts.instructions
      ? [`Additional instructions from the developer: ${opts.instructions}`]
      : []),
  ].join("\n");
  return {
    system: `${brief.kind === "week" ? WEEK_SYSTEM : SYSTEM}\n\n${style}`,
    prompt: out.join("\n"),
  };
};
