import { describe, expect, it } from "vitest";
import {
  cleanName,
  cleanTitle,
  isTrivialPrompt,
  shortenUrl,
  tidyTitle,
  titleFromPrompts,
  truncateWords,
} from "../../src/util/title";
describe("cleanTitle", () => {
  it("takes the first meaningful line and collapses whitespace", () => {
    expect(
      cleanTitle("\n\n  Fix   the flaky\tscheduler test\nit fails on CI about 1 in 5 runs"),
    ).toBe("Fix the flaky scheduler test");
  });
  it("stops at the first sentence when the line runs long", () => {
    const raw =
      "Grill me on this project plan. Closenack Product Specification v1.0 Brand Name, Positioning, Audience, Pricing and everything else";
    expect(cleanTitle(raw)).toBe("Grill me on this project plan");
  });
  it("truncates at ~80 chars on a word boundary with an ellipsis", () => {
    const raw =
      "I found a bug in the current fetching of postings which are initially rated highly but then drop off after a refresh";
    const t = cleanTitle(raw);
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t).toBe("I found a bug in the current fetching of postings which are initially rated…");
  });
  it("shortens URLs to host/path, dropping scheme, www, query and fragment", () => {
    expect(
      cleanTitle("Review https://www.github.com/acme/rundown/pull/42?tab=files#r1 please"),
    ).toBe("Review github.com/acme/rundown/pull/42 please");
    expect(
      cleanTitle(
        "HTTP 403 fetching https://www.sqlink.com/career/bidbabig-data/data-engineer/data-engineer-3/?utm=x",
      ),
    ).toBe("HTTP 403 fetching sqlink.com/…/data-engineer/data-engineer-3");
  });
  it("strips harness tags with their content, and slash-command prefixes", () => {
    expect(
      cleanTitle(
        "<system-reminder>\nYou have tools. Be careful.\n</system-reminder>\n/plan add a daemon command",
      ),
    ).toBe("Add a daemon command");
    expect(
      cleanTitle(
        "<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>the auth refactor</command-args>",
      ),
    ).toBe("The auth refactor");
    expect(cleanTitle("<command-name>/review</command-name>")).toBe("/review");
  });
  it("drops pasted blocks, code fences and markdown", () => {
    expect(cleanTitle("[Pasted text #1 +40 lines]\nwhy does this crash?")).toBe(
      "Why does this crash?",
    );
    expect(
      cleanTitle(
        "```\nTypeError: x is undefined\n  at foo (a.ts:1)\n```\n## Fix **this** error in `parse()`",
      ),
    ).toBe("Fix this error in parse()");
    expect(cleanTitle("see [the docs](https://example.com/a/b) for the API")).toBe(
      "See the docs for the API",
    );
  });
  it("keeps identifiers as written, and reads slugs as words", () => {
    expect(cleanTitle(".env file with NIM key")).toBe(".env file with NIM key");
    expect(cleanTitle("capish-4012 enum migration")).toBe("capish-4012 enum migration");
    expect(cleanTitle("pr-review-comments-triage")).toBe("PR review comments triage");
  });
  it("returns empty when nothing meaningful is left", () => {
    expect(cleanTitle("<environment_context><cwd>/x</cwd></environment_context>")).toBe("");
    expect(cleanTitle("   \n ")).toBe("");
  });
});
describe("cleanName", () => {
  it("keeps a tool-chosen title's wording, fixing only slugs, spacing and length", () => {
    expect(cleanName("/organize-commits history rewrite")).toBe(
      "/organize-commits history rewrite",
    );
    expect(cleanName("pr review  comment resolution")).toBe("PR review comment resolution");
    expect(cleanName("feelings-slider-focus-review")).toBe("Feelings slider focus review");
  });
});
describe("titleFromPrompts", () => {
  it("skips greetings in favour of the first real ask", () => {
    expect(titleFromPrompts(["hi", "hello there!", "Add retries to the GitHub client"])).toBe(
      "Add retries to the GitHub client",
    );
    expect(isTrivialPrompt("ok")).toBe(true);
    expect(isTrivialPrompt("Fix the build")).toBe(false);
  });
  it("falls back to a trivial prompt when that's all there is", () => {
    expect(titleFromPrompts(["hi"])).toBe("Hi");
    expect(titleFromPrompts([])).toBeUndefined();
  });
});
describe("helpers", () => {
  it("shortenUrl leaves short URLs whole and non-URLs alone", () => {
    expect(shortenUrl("https://linear.app/acme/issue/ENG-12")).toBe("linear.app/acme/issue/ENG-12");
    expect(shortenUrl("not a url")).toBe("not a url");
  });
  it("truncateWords cuts on a word boundary", () => {
    expect(truncateWords("alpha beta gamma delta", 15)).toBe("alpha beta…");
    expect(truncateWords("short", 15)).toBe("short");
  });
  it("tidyTitle cleans raw-looking titles but passes clean ones through", () => {
    expect(tidyTitle("Build the rundown daemon")).toBe("Build the rundown daemon");
    expect(tidyTitle("/organize-commits history rewrite")).toBe(
      "/organize-commits history rewrite",
    );
    expect(tidyTitle("look at https://github.com/acme/rundown/issues/9\nand more")).toBe(
      "Look at github.com/acme/rundown/issues/9",
    );
  });
});
