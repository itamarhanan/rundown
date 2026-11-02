import * as os from "node:os";
import { defaultModel, providerEnvKey } from "./load";
import type { AgentName, Delivery, Provider } from "./schema";
export interface ConfigDraft {
  readonly name: string;
  readonly email?: string;
  readonly timezone: string;
  readonly workdays: readonly number[];
  readonly provider: Provider;
  readonly repos: readonly string[];
  readonly authors: readonly string[];
  readonly agents: readonly AgentName[];
  readonly ics: readonly string[];
  readonly linear: boolean;
  readonly morningBrief: string;
  readonly delivery: Delivery;
}
const tilde = (p: string) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);
const v = (value: string) => JSON.stringify(value);
const list = (items: readonly string[], indent: string) =>
  items.length === 0 ? " []" : `\n${items.map((i) => `${indent}- ${v(i)}`).join("\n")}`;
export const renderConfig = (d: ConfigDraft): string => {
  const envKey = providerEnvKey[d.provider];
  const agent = (a: AgentName) => `    ${a}: ${d.agents.includes(a)}`;
  return `# Rundown config. Docs: https://github.com/itamarhanan/rundown#config
# Secrets never live here. Set them in your shell; \${VAR} interpolation also works.

user:
  name: ${v(d.name)}${d.email ? `\n  email: ${v(d.email)}` : ""}
  timezone: ${v(d.timezone)}
  # 0 = Sunday … 6 = Saturday. "yesterday" means the last of these days.
  workdays: [${d.workdays.join(", ")}]

llm:
  provider: ${d.provider} # groq | openai | anthropic | nvidia | ollama
  model: ${v(defaultModel[d.provider])}${envKey ? `\n  # key: $${envKey}` : "\n  # baseUrl: http://localhost:11434/v1"}
  maxWords: 150
  # instructions: "Write in Hebrew. Mention ticket ids."

sources:
  git:
    # Repos, or folders that contain repos (scanned 3 levels deep).
    repos:${list(d.repos.map(tilde), "      ")}
    # Matched against commit author name/email.
    authors:${list(d.authors, "      ")}
  github:
    enabled: true # token: $GITHUB_TOKEN, $GH_TOKEN, or \`gh auth token\`
    # orgs: [my-org]
  linear:
    enabled: ${d.linear} # key: $LINEAR_API_KEY
  calendar:
    # ICS feeds: Google Calendar → Settings → "Secret address in iCal format".
    ics:${list(d.ics, "      ")}
  agents:
${(["opencode", "claude", "cursor", "aider", "codex", "vscode"] as const).map(agent).join("\n")}
  shell:
    enabled: false

schedule:
  morningBrief: ${v(d.morningBrief)}
  delivery: ${d.delivery} # notification | terminal | web | file
`;
};
