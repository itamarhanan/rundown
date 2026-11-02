import type { SourceReport, SourceStatus } from "@rundown/core";
import { Box, Text, type TextProps, Transform, useAnimation } from "ink";
import type { ReactNode } from "react";
export type Tone = "ok" | "warn" | "fail";
const TONE_COLOR: Record<Tone, string> = {
  ok: "green",
  warn: "yellow",
  fail: "red",
};
export const tone = (t: Tone): string | undefined =>
  process.env.NO_COLOR ? undefined : TONE_COLOR[t];
const MAX_WIDTH = 100;
export const contentWidth = (columns: number | undefined) =>
  Math.max(40, Math.min(columns || 80, MAX_WIDTH));
const MARK: Record<
  SourceStatus,
  {
    symbol: string;
    word: string;
    tone?: Tone;
  }
> = {
  ok: { symbol: "✓", word: "ok", tone: "ok" },
  failed: { symbol: "!", word: "failed", tone: "fail" },
  skipped: { symbol: "–", word: "off" },
};
export const SourceMark = ({ r }: { r: SourceReport }) => {
  const m = MARK[r.status];
  return (
    <Text>
      {m.tone ? <Text color={tone(m.tone)}>{m.symbol}</Text> : <Text dimColor>{m.symbol}</Text>}{" "}
      <Text dimColor={r.status === "skipped"}>{r.label}</Text>{" "}
      {r.status === "ok" ? (
        <Text dimColor>{r.count}</Text>
      ) : (
        <Text color={m.tone ? tone(m.tone) : undefined} dimColor={!m.tone}>
          {m.word}
        </Text>
      )}
    </Text>
  );
};
export const StatusWord = ({ status }: { status: SourceStatus }) => {
  const m = MARK[status];
  return m.tone ? (
    <Text color={tone(m.tone)}>
      {m.symbol} {m.word}
    </Text>
  ) : (
    <Text dimColor>
      {m.symbol} {m.word}
    </Text>
  );
};
export const Notice = ({ kind, children }: { kind: Tone | "info"; children: ReactNode }) => {
  const symbol = kind === "ok" ? "✓" : kind === "fail" ? "!" : kind === "warn" ? "Note:" : "·";
  return (
    <Box>
      <Box flexShrink={0} marginRight={1}>
        <Text
          color={kind === "info" ? undefined : tone(kind)}
          dimColor={kind === "info"}
          bold={kind === "warn"}
        >
          {symbol}
        </Text>
      </Box>
      <Box flexShrink={1}>
        <Para>{children}</Para>
      </Box>
    </Box>
  );
};
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const Spinner = ({ label }: { label: ReactNode }) => {
  const { frame } = useAnimation({ interval: 80 });
  return (
    <Text>
      <Text dimColor>{FRAMES[frame % FRAMES.length]}</Text> {label}
    </Text>
  );
};
export const Label = ({ children, aside }: { children: string; aside?: string | undefined }) => (
  <Para>
    <Text bold>{children.toUpperCase()}</Text>
    {aside ? <Text dimColor>{`  ${aside}`}</Text> : null}
  </Para>
);
const LEAD = /^((?:\u001B\[[0-9;]*m)*) +/;
export const Para = ({ children, ...props }: Omit<TextProps, "wrap">) => (
  <Transform transform={(line, i) => (i > 0 ? line.replace(LEAD, "$1") : line)}>
    <Text wrap="wrap" {...props}>
      {children}
    </Text>
  </Transform>
);
