export const TITLE_MAX = 80;
const NOISE_BLOCK =
  /<(system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|command-message|environment_context|user_instructions|ide_opened_file|ide_selection|ide_diagnostics|bash-input|bash-stdout|bash-stderr|task-notification|user-prompt-submit-hook)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMAND_NAME = /<command-name>\s*([^<]*?)\s*<\/command-name>/i;
const COMMAND_ARGS = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/i;
export const shortenUrl = (url: string): string => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.hostname.replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean);
  const full = segs.length ? `${host}/${segs.join("/")}` : host;
  if (full.length <= 40) return full;
  const tail = segs.slice(-2).join("/");
  return segs.length > 2 && `${host}/…/${tail}`.length < full.length ? `${host}/…/${tail}` : full;
};
const ACRONYMS = new Set([
  "pr",
  "prs",
  "qa",
  "api",
  "ui",
  "ux",
  "ci",
  "cd",
  "dto",
  "llm",
  "cli",
  "tui",
  "css",
  "html",
  "sql",
]);
const unslug = (s: string): string => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(s)) return s;
  return s
    .replace(/([a-z]+)-(\d+)/g, "$1\u0000$2")
    .split("-")
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w))
    .join(" ")
    .replace(/\u0000/g, "-");
};
const capitalize = (s: string) => {
  const first = /^[a-z]+(?=\s|$)/.exec(s)?.[0];
  if (first && ACRONYMS.has(first)) return first.toUpperCase() + s.slice(first.length);
  return /^[a-z]/.test(s) && !/^[a-z]+[-_./][a-z0-9]/i.test(s)
    ? s[0]!.toUpperCase() + s.slice(1)
    : s;
};
export const truncateWords = (s: string, max = TITLE_MAX): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const head = space >= max * 0.5 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:.@&\-–—(/]+$/, "")}…`;
};
const stripMarkdown = (s: string): string =>
  s
    .replace(/```[\s\S]*?(```|$)/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
    .replace(/\[(?:Pasted text|Image|File)[^\]]*\]/gi, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "");
const meaningful = (line: string) => /[\p{L}\p{N}]{2,}/u.test(line);
const firstSentence = (line: string, max: number): string => {
  if (line.length <= max) return line;
  const m = /^(.{20,}?[.!?])\s+(?=[\p{Lu}\p{N}"'(])/u.exec(line);
  return m ? m[1]! : line;
};
export const cleanTitle = (raw: string, max = TITLE_MAX): string => {
  let text = raw.replace(/\r\n?/g, "\n");
  const command = COMMAND_NAME.exec(text)?.[1];
  const args = COMMAND_ARGS.exec(text)?.[1];
  text = text.replace(NOISE_BLOCK, "\n").replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?>/gi, "\n");
  if (command) text = args ? `${command} ${args}\n${text}` : `${command}\n${text}`;
  text = stripMarkdown(text).replace(/https?:\/\/[^\s<>"'`)\]]+/g, (u) =>
    shortenUrl(u.replace(/[.,;:!?]+$/, "")),
  );
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(meaningful);
  let line = lines[0] ?? "";
  const withoutCommand = line.replace(/^\/[\w:-]+\s+/, "");
  if (meaningful(withoutCommand)) line = withoutCommand;
  line = firstSentence(line, max)
    .replace(/^[\s,;:\-–—]+/, "")
    .replace(/(?<!\.)\.$/, "")
    .replace(/[\s,;:]+$/, "");
  return truncateWords(capitalize(unslug(line)), max);
};
export const cleanName = (raw: string, max = TITLE_MAX): string => {
  const line = raw.replace(/\s+/g, " ").trim();
  return line ? truncateWords(capitalize(unslug(line)), max) : "";
};
export const isTrivialPrompt = (text: string): boolean => {
  const t = cleanTitle(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
  return (
    t.length < 4 ||
    /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|yes|no|y|n|continue|go on|go ahead|proceed|test|ping)( there)?$/.test(
      t,
    )
  );
};
export const titleFromPrompts = (
  prompts: readonly string[],
  max = TITLE_MAX,
): string | undefined => {
  const good = prompts.find((p) => !isTrivialPrompt(p));
  const pick = good ?? prompts.find((p) => cleanTitle(p, max));
  const title = pick ? cleanTitle(pick, max) : "";
  return title || undefined;
};
export const PROMPT_KEEP = 2000;
export const keepPrompt = (text: string): string => {
  const t = text.trim();
  return t.length > PROMPT_KEEP ? `${t.slice(0, PROMPT_KEEP - 1)}…` : t;
};
export const tidyTitle = (title: string, max = TITLE_MAX): string =>
  title.length > max || /[\n<`]|https?:\/\/|\[Pasted/.test(title)
    ? cleanTitle(title, max) || title.slice(0, max)
    : title;
