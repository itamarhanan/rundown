# Rundown

Standup prep in one command. Rundown reads your git commits, GitHub PRs,
calendar events, Linear issues, and AI coding-agent sessions, then writes a
standup summary: yesterday's work, today's plan, blockers. It prints the
summary in your terminal, posts a notification, writes a file, or serves it on
a local web page.

## Features

- Briefs: `yesterday`, `today`, `morning`, and `week` summaries, written by an
  LLM in your voice and capped at a word budget you control.
- Sources: git repositories (or folders scanned for repos), GitHub PRs,
  Linear, Google Calendar or any ICS feed, and shell command history.
- Agent sessions: picks up work from Claude Code, Codex, Cursor, OpenCode,
  Aider, and VS Code sessions.
- Web UI: a local dashboard with brief history, source health, and activity
  drill-down.
- Daemon: schedules the morning brief and delivers it however you like.
- Secrets stay out of the config file. They are read from your shell, and the
  cache is a local SQLite database in your data directory.

## Prerequisites

- Node.js >= 22
- pnpm >= 10 (for development)
- git (required)
- `gh` (optional, but recommended: Rundown reuses your GitHub login for PR
  data)
- An LLM API key for the provider you pick: `GROQ_API_KEY`, `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, or `NVIDIA_API_KEY`. `ollama` needs none.

## Install

Rundown isn't on npm. Install from source:

```bash
git clone https://github.com/itamarhanan/rundown.git
cd rundown
pnpm install
pnpm build            # once; binaries land in packages/*/dist
./rundown --help
```

The built CLI reads `@rundown/core`'s compiled output, so run `pnpm build`
after pulling changes that touch `packages/core`.

`./rundown` works from the repo root. If you want `rundown` on your PATH from
anywhere, link the built CLI globally:

```bash
pnpm --filter @rundown/cli link --global
```

## Quick start

```bash
rundown init          # interactive setup: identity, provider, repos, calendars
rundown yesterday     # standup summary for your last workday
rundown today         # today's focus
rundown morning       # morning brief
rundown week          # weekly summary
rundown serve         # start the local web UI
```

## Commands

| Command                | What it does                                |
| ---------------------- | ------------------------------------------- |
| `rundown init`         | Interactive guided setup                    |
| `rundown yesterday`    | Standup summary for the last workday        |
| `rundown today`        | Today's focus                               |
| `rundown morning`      | Morning brief                               |
| `rundown week`         | Weekly summary                              |
| `rundown serve`        | Start the local web UI (default port 4477)  |
| `rundown daemon`       | Background scheduler for the morning brief  |
| `rundown sources`      | Inspect configured sources and their health |
| `rundown config`       | Show the effective configuration            |
| `rundown sources list` | List configured sources                     |

## Configuration

On first run, `rundown init` writes `~/.config/rundown/config.yaml` with sane
defaults. An annotated example:

```yaml
user:
  name: Ada Lovelace
  email: ada@example.com
  timezone: Asia/Jerusalem
  workdays: [0, 1, 2, 3, 4] # 0 = Sunday

llm:
  provider: groq # groq | openai | anthropic | nvidia | ollama
  model: openai/gpt-oss-120b
  # key is read from $GROQ_API_KEY; or set apiKey here (not recommended)
  maxWords: 150
  # instructions: "Write in Hebrew. Mention ticket ids."

sources:
  git:
    repos:
      - ~/projects # folders are scanned 3 levels deep
    authors:
      - Ada Lovelace
      - ada@example.com
  github:
    enabled: true # token: $GITHUB_TOKEN, $GH_TOKEN, or `gh auth token`
    # orgs: [my-org]
  linear:
    enabled: true # key: $LINEAR_API_KEY
  calendar:
    ics: # Google Calendar → Settings → secret iCal address
      - https://calendar.google.com/calendar/ical/…/basic.ics
  agents:
    opencode: true
    claude: true
    cursor: true
    aider: true
    codex: true
    vscode: true
  shell:
    enabled: false

schedule:
  morningBrief: "08:30"
  delivery: notification # notification | terminal | web | file
```

Configuration paths:

- Config file: `~/.config/rundown/config.yaml` (override with `RUNDOWN_CONFIG`)
- Data directory: `~/.local/share/rundown/` (override with `RUNDOWN_DATA_DIR`)

Environment variables used:

| Variable                                                                   | Purpose                                 |
| -------------------------------------------------------------------------- | --------------------------------------- |
| `GROQ_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `NVIDIA_API_KEY` | LLM provider key, per selected provider |
| `GITHUB_TOKEN`, `GH_TOKEN`                                                 | GitHub PR access                        |
| `LINEAR_API_KEY`                                                           | Linear access                           |
| `RUNDOWN_CONFIG`                                                           | Override the config file path           |
| `RUNDOWN_DATA_DIR`                                                         | Override the data directory             |

## Web UI

Run `rundown serve` (or let the daemon's `web` delivery open it for you) and
browse to `http://localhost:4477`. The page shows the current brief, its
standup and plan sections, brief history, and per-source health.

## Daemon and scheduling

`rundown daemon` runs in the background, fires the morning brief at the
configured time, and honors `schedule.delivery`. On macOS the daemon can
register a LaunchAgent; `rundown daemon --uninstall` removes it.

## Development

Root scripts (all use pnpm, never npm):

| Script              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `pnpm install`      | Install workspace dependencies                 |
| `pnpm build`        | Build core + web, then the CLI                 |
| `pnpm dev`          | Run the CLI in dev mode with source conditions |
| `pnpm smoke`        | Build and run `rundown sources list`           |
| `pnpm typecheck`    | Typecheck every package                        |
| `pnpm test`         | Run vitest suites                              |
| `pnpm lint`         | Run oxlint                                     |
| `pnpm format`       | Write oxfmt formatting                         |
| `pnpm format:check` | Verify oxfmt formatting                        |

The repo is a pnpm workspace:

- `packages/core`: shared sources, agent adapters, domain, and brief services
- `packages/cli`: commands, TUI, local server
- `packages/web`: the dashboard bundled and served by the CLI

## Troubleshooting

GitHub PRs missing: run `gh auth login`, or export `GITHUB_TOKEN`.

Calendar errors: re-copy the calendar's secret iCal address. Public share
links are rejected.

Linear errors: check `$LINEAR_API_KEY` and that the linear source is enabled.

LLM errors: confirm the provider's API key is set and reachable. For `ollama`,
confirm the local server is up and the model name matches.

## Security notes

- API keys are read from the environment, and `${VAR}` interpolation in the
  config file resolves at load time. Secrets never need to touch disk.
- Cached activities live in a local SQLite database in the data directory.

## Contributing

1. Fork, then create a branch off `main`.
2. Make changes with tests where practical.
3. Run `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check`.
4. Open a pull request; CI must pass.

## License

[MIT](LICENSE)
