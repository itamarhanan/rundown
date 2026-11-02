import type { Activity, OpenItem } from "../src/domain/activity";
let seq = 0;
export const act = (over: Partial<Activity> & Pick<Activity, "type" | "timestamp">): Activity => ({
  id: `test:${++seq}`,
  source:
    over.type === "meeting"
      ? "calendar"
      : over.type === "agent-session"
        ? "agent"
        : over.type === "command"
          ? "shell"
          : over.type === "commit"
            ? "git"
            : "github-pr",
  title: `${over.type} ${seq}`,
  metadata: {},
  ...over,
});
export const openItem = (over: Partial<OpenItem> & Pick<OpenItem, "kind" | "ref">): OpenItem => ({
  id: `open:${over.ref}`,
  source: "github",
  title: `Item ${over.ref}`,
  url: `https://github.com/acme/rundown/pull/${over.ref.replace("#", "")}`,
  updatedAt: new Date("2026-11-08T06:00:00Z"),
  ...over,
});
export const at = (iso: string) => new Date(iso);
