#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { VERSION } from "./version";
const main = defineCommand({
  meta: {
    name: "rundown",
    version: VERSION,
    description: "Standup prep in one command",
  },
  subCommands: {
    morning: () => import("./commands/brief").then((m) => m.briefCommand("morning")),
    yesterday: () => import("./commands/brief").then((m) => m.briefCommand("yesterday")),
    today: () => import("./commands/brief").then((m) => m.briefCommand("today")),
    week: () => import("./commands/brief").then((m) => m.briefCommand("week")),
    serve: () => import("./commands/serve").then((m) => m.default),
    daemon: () => import("./commands/daemon").then((m) => m.default),
    sources: () => import("./commands/sources").then((m) => m.default),
    config: () => import("./commands/config").then((m) => m.default),
    init: () => import("./commands/init").then((m) => m.default),
  },
});
void runMain(main);
