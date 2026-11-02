import { Box, Text } from "ink";
import { Para } from "./theme";
interface Segment {
  readonly text: string;
  readonly bold?: boolean;
  readonly code?: boolean;
}
interface Line {
  readonly depth: number;
  readonly bullet: boolean;
  readonly segments: readonly Segment[];
}
const inline = (text: string): Segment[] =>
  text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? { text: part.slice(2, -2), bold: true }
        : part.startsWith("`") && part.endsWith("`")
          ? { text: part.slice(1, -1), code: true }
          : { text: part },
    );
export const parseMarkdown = (md: string): Line[] =>
  md.split("\n").map((raw) => {
    const m = /^(\s*)[-*]\s+(.*)$/.exec(raw);
    if (m) return { depth: Math.floor(m[1]!.length / 2), bullet: true, segments: inline(m[2]!) };
    const heading = /^#{1,6}\s+(.*)$/.exec(raw);
    if (heading) return { depth: 0, bullet: false, segments: [{ text: heading[1]!, bold: true }] };
    return { depth: 0, bullet: false, segments: inline(raw) };
  });
export const Markdown = ({ text }: { readonly text: string }) => (
  <Box flexDirection="column">
    {parseMarkdown(text).map((line, i) => (
      <Box key={i} paddingLeft={line.depth * 2}>
        {line.bullet && (
          <Box flexShrink={0}>
            <Text dimColor>{line.depth === 0 ? "• " : "◦ "}</Text>
          </Box>
        )}
        <Box flexShrink={1}>
          <Para>
            {line.segments.length === 0 ? " " : null}
            {line.segments.map((s, j) => (
              <Text key={j} bold={Boolean(s.bold)}>
                {s.text}
              </Text>
            ))}
          </Para>
        </Box>
      </Box>
    ))}
  </Box>
);
