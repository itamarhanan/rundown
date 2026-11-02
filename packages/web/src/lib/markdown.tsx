import type { ReactNode } from "react";
type Block =
  | {
      readonly kind: "heading";
      readonly text: string;
    }
  | {
      readonly kind: "para";
      readonly text: string;
    }
  | {
      readonly kind: "list";
      readonly items: ListItem[];
    };
interface ListItem {
  text: string;
  children: ListItem[];
}
const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const HEADING = /^(?:#{1,6}\s+(.+?)|\*\*([^*]+?)\*\*:?)\s*$/;
const parse = (src: string): Block[] => {
  const blocks: Block[] = [];
  let list: ListItem[] | undefined;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      list = undefined;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      if (!list) {
        list = [];
        blocks.push({ kind: "list", items: list });
      }
      const depth = Math.floor((bullet[1] ?? "").replace(/\t/g, "  ").length / 2);
      let siblings = list;
      for (let d = 0; d < depth; d++) {
        const parent = siblings[siblings.length - 1];
        if (!parent) break;
        siblings = parent.children;
      }
      siblings.push({ text: bullet[2] ?? "", children: [] });
      continue;
    }
    const heading = HEADING.exec(line.trim());
    if (heading) {
      flushPara();
      list = undefined;
      blocks.push({ kind: "heading", text: heading[1] ?? heading[2] ?? "" });
      continue;
    }
    if (list && /^\s+/.test(raw)) {
      const last = lastLeaf(list);
      if (last) {
        last.text += ` ${line.trim()}`;
        continue;
      }
    }
    list = undefined;
    para.push(line.trim());
  }
  flushPara();
  return blocks;
};
const lastLeaf = (items: ListItem[]): ListItem | undefined => {
  const last = items[items.length - 1];
  if (!last) return undefined;
  return last.children.length ? lastLeaf(last.children) : last;
};
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
export const renderInline = (text: string): ReactNode[] =>
  text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded-sm bg-fill px-1 py-px text-[0.875em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link && /^https?:\/\//.test(link[2] ?? "")) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-content-tertiary underline-offset-2 hover:decoration-content"
        >
          {link[1]}
        </a>
      );
    }
    return renderRefs(part, i);
  });
const REF = /((?:\b[\w.-]+)?#\d+\b|\b[A-Z][A-Z0-9]{1,9}-\d+\b)/g;
const renderRefs = (text: string, key: number): ReactNode => {
  const parts = text.split(REF);
  if (parts.length === 1) return text;
  return (
    <span key={key}>
      {parts.map((p, j) =>
        j % 2 === 1 ? (
          <span key={j} className="font-mono text-[0.9em] text-content-secondary">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </span>
  );
};
const List = ({ items, nested = false }: { items: readonly ListItem[]; nested?: boolean }) => (
  <ul className={nested ? "mt-1 space-y-1 pl-5 text-content-secondary" : "space-y-1.5 pl-5"}>
    {items.map((item, i) => (
      <li
        key={i}
        className={
          nested
            ? "list-[circle] marker:text-content-tertiary"
            : "list-disc marker:text-content-tertiary"
        }
      >
        {renderInline(item.text)}
        {item.children.length > 0 && <List items={item.children} nested />}
      </li>
    ))}
  </ul>
);
export const Markdown = ({ text, className }: { text: string; className?: string }) => (
  <div className={className ?? "space-y-3 text-doc [overflow-wrap:anywhere]"}>
    {parse(text).map((block, i) => {
      switch (block.kind) {
        case "heading":
          return (
            <h3 key={i} className="pt-3 font-semibold first:pt-0">
              {renderInline(block.text)}
            </h3>
          );
        case "para":
          return <p key={i}>{renderInline(block.text)}</p>;
        case "list":
          return <List key={i} items={block.items} />;
      }
    })}
  </div>
);
