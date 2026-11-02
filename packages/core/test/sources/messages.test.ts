import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { feedFailure, llmAvailability, readOpenCodeSessions, redactFeed } from "../../src";
import type { Config } from "../../src/config/schema";
const SECRET =
  "https://calendar.google.com/calendar/ical/ada%40example.com/private-0123456789abcdef0123456789abcdef/basic.ics";
describe("calendar feed failures", () => {
  it("never prints the secret part of a feed URL", () => {
    expect(redactFeed(SECRET)).toBe("https://calendar.google.com/…/basic.ics");
    expect(
      redactFeed("webcal://p01-caldav.icloud.com/published/2/MTIzNDU2Nzg5MDEyMzQ1Njc4OTA"),
    ).toBe("https://p01-caldav.icloud.com/…");
    expect(redactFeed("https://example.com/feed?token=abc123")).toBe("https://example.com/…");
    expect(redactFeed("https://user:pw@example.com/cal.ics")).toBe("https://example.com/…/cal.ics");
    expect(redactFeed("~/cal/work.ics")).toBe("~/cal/work.ics");
  });
  it("says a 404 is the configured URL, and how to fix it", () => {
    const f = feedFailure(SECRET, { status: 404 });
    expect(f.message).toBe(
      "calendar URL https://calendar.google.com/…/basic.ics returned HTTP 404 (not found)",
    );
    expect(f.hint).toContain("sources.calendar.ics");
    expect(f.hint).toContain("rundown config --edit");
    expect(JSON.stringify(f)).not.toContain("private-0123");
  });
  it("explains refusals, and masks the URL inside transport errors", () => {
    expect(feedFailure(SECRET, { status: 403 }).hint).toMatch(/refused/);
    const f = feedFailure(SECRET, { message: `Transport error (GET ${SECRET})` });
    expect(f.message).toBe(
      "couldn't reach calendar URL https://calendar.google.com/…/basic.ics: Transport error (GET https://calendar.google.com/…/basic.ics)",
    );
    expect(JSON.stringify(f)).not.toContain("private-0123");
  });
});
describe("llmAvailability", () => {
  const llm = (over: Partial<Config["llm"]>): Config["llm"] => ({
    enabled: true,
    provider: "groq",
    model: "openai/gpt-oss-120b",
    maxWords: 150,
    ...over,
  });
  it("names the env var for the configured provider, and never suggests config", () => {
    for (const [provider, envVar] of [
      ["groq", "GROQ_API_KEY"],
      ["anthropic", "ANTHROPIC_API_KEY"],
      ["openai", "OPENAI_API_KEY"],
    ] as const) {
      const a = llmAvailability(llm({ provider, model: "m" }));
      expect(a.ok).toBe(false);
      if (a.ok) continue;
      expect(a.reason).toContain(`export ${envVar}=`);
      expect(a.reason).toContain(`${provider}/m`);
      expect(a.reason).not.toMatch(/config|apiKey/i);
    }
  });
  it("is available with a key, or with a keyless provider", () => {
    expect(llmAvailability(llm({ apiKey: "k" }))).toEqual({
      ok: true,
      model: "groq/openai/gpt-oss-120b",
    });
    expect(llmAvailability(llm({ provider: "ollama", model: "llama3.2" })).ok).toBe(true);
  });
});
describe("readOpenCodeSessions titles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-opencode-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "opencode.db");
  const db = new Database(file);
  db.exec(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, directory TEXT NOT NULL, model TEXT,
      agent TEXT, time_viewed INTEGER, summary_files INTEGER, summary_additions INTEGER, summary_deletions INTEGER);
    CREATE TABLE session_message (session_id TEXT, seq INTEGER, type TEXT, data TEXT, time_created INTEGER);`);
  const t0 = Date.UTC(2026, 10, 5, 9);
  const session = (id: string, title: string | null, prompts: string[]) => {
    db.prepare(
      "INSERT INTO session_v2 (id, title, directory, agent) VALUES (?, ?, '/home/dev/work/scout', 'build')",
    ).run(id, title);
    prompts.forEach((text, i) =>
      db
        .prepare("INSERT INTO session_message VALUES (?, ?, 'user', ?, ?)")
        .run(id, i, JSON.stringify({ text }), t0 + i * 60000),
    );
  };
  session("titled", "Job listing rendering bug fix", ["whatever"]);
  session("placeholder", "New session - 2026-11-05T09:00:00.000Z", [
    "Add a dark theme to the desktop app",
  ]);
  session("greeting", null, [
    "hi",
    "My AI analysis is extremely slow on the App. I have dozens of positions to analyze",
  ]);
  session("empty", null, ["<environment_context/>"]);
  db.close();
  const byId = Object.fromEntries(
    readOpenCodeSessions(file, { start: new Date(t0 - 3600000), end: new Date(t0 + 3600000) }).map(
      (s) => [s.id, s],
    ),
  );
  it("prefers OpenCode's own title, ignoring its placeholder", () => {
    expect(byId.titled!.title).toBe("Job listing rendering bug fix");
    expect(byId.placeholder!.title).toBe("Add a dark theme to the desktop app");
  });
  it("derives a clean title from the first real prompt and keeps the prompt", () => {
    expect(byId.greeting!.title).toBe("My AI analysis is extremely slow on the App");
    expect(byId.greeting!.prompt).toBe(
      "My AI analysis is extremely slow on the App. I have dozens of positions to analyze",
    );
    expect(byId.empty!.title).toBe("OpenCode session");
  });
});
