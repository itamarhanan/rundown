# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-02

### Added

- Initial release.
- Activity sources: git, GitHub, calendar (ICS), Linear, agent sessions, shell.
- Agent adapters: Claude Code, Codex, Cursor, OpenCode, Aider, VS Code.
- Brief commands: `yesterday`, `today`, `morning`, `week`.
- Interactive setup via `rundown init`.
- Local web UI via `rundown serve`.
- Background scheduler via `rundown daemon` for the morning brief.

### Known Issues

- One transitive dependency (`deepmerge`, pulled in by `@inkjs/ui`) reports a
  low-severity advisory with no patched release yet. It is inert for Rundown's
  usage and will be resolved when upstream ships a fix.
