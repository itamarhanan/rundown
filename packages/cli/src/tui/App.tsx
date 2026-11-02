import {
  type Brief,
  type BriefKind,
  type BriefOptions,
  Briefs,
  RundownConfig,
  type SourceReport,
} from "@rundown/core";
import { Effect } from "effect";
import { Box, Static, Text, useApp, useInput, useWindowSize } from "ink";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { runPromise } from "../runtime";
import { copyToClipboard, editInEditor, openUrl } from "../util/system";
import {
  BriefView,
  KeysLive,
  LIST_LIMIT,
  PlanSections,
  ReceiptSections,
  SourceFooter,
  Standup,
  type ViewState,
  calendarFor,
} from "./BriefView";
import { Notice, Para, SourceMark, Spinner, type Tone, contentWidth } from "./theme";
export interface AppProps {
  readonly kind: BriefKind;
  readonly options: Omit<BriefOptions, "onReport">;
  readonly interactive: boolean;
  readonly initial: ViewState;
  readonly copy?: boolean;
}
type Phase =
  | {
      readonly tag: "loading";
      readonly reports: readonly SourceReport[];
      readonly label: string;
    }
  | {
      readonly tag: "ready";
    }
  | {
      readonly tag: "error";
      readonly message: string;
      readonly hint?: string;
    }
  | {
      readonly tag: "done";
    };
interface Flash {
  readonly kind: Tone | "info";
  readonly text: ReactNode;
}
interface Entry {
  readonly id: number;
  readonly node: ReactNode;
}
const build = (kind: BriefKind, options: BriefOptions) =>
  runPromise(Effect.flatMap(Briefs, (b) => b.build(kind, options)));
const message = (e: unknown) => {
  const err = (typeof e === "object" && e !== null ? e : {}) as {
    message?: string;
    hint?: string;
  };
  return {
    message: err.message ?? String(e),
    ...(err.hint ? { hint: err.hint } : {}),
  };
};
const Progress = ({ reports, label }: { reports: readonly SourceReport[]; label: string }) => (
  <Box flexDirection="column">
    <Spinner
      label={`${label}${reports.length ? ` · ${reports.length} ${reports.length === 1 ? "source" : "sources"} answered` : "…"}`}
    />
    {reports.length > 0 && (
      <Box flexWrap="wrap" columnGap={3} paddingLeft={2}>
        {reports.map((r) => (
          <Box key={r.id}>
            <SourceMark r={r} />
          </Box>
        ))}
      </Box>
    )}
  </Box>
);
const KEYS: readonly (readonly [key: string, label: string, short: string])[] = [
  ["c", "copy", "copy"],
  ["e", "edit", "edit"],
  ["r", "regenerate", "regen"],
  ["d", "details", "details"],
  ["s", "sources", "sources"],
  ["o", "open web", "web"],
  ["q", "quit", "quit"],
];
const KeyBar = ({ width }: { width: number }) => {
  const short = width < 76;
  return (
    <Para>
      {KEYS.map(([k, label, abbr], i) => (
        <Text key={k}>
          {i ? "  " : ""}
          <Text bold>{k}</Text>
          <Text dimColor> {short ? abbr : label}</Text>
        </Text>
      ))}
    </Para>
  );
};
const webPath = (kind: BriefKind, options: Omit<BriefOptions, "onReport">) => {
  const q = new URLSearchParams();
  if (options.date) q.set("date", options.date);
  if (options.weekOffset === -1) q.set("last", "1");
  const s = q.toString();
  return `/${kind}${s ? `?${s}` : ""}`;
};
const serverUp = async (base: string) => {
  try {
    const res = await fetch(`${base}/api/meta`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
};
export const App = ({ kind, options, interactive, initial, copy }: AppProps) => {
  const { exit, suspendTerminal } = useApp();
  const { columns } = useWindowSize();
  const width = contentWidth(columns);
  const [phase, setPhase] = useState<Phase>({
    tag: "loading",
    reports: [],
    label: "Collecting activity",
  });
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [busy, setBusy] = useState<string | undefined>();
  const [confirm, setConfirm] = useState(false);
  const [flash, setFlash] = useState<Flash | undefined>();
  const brief = useRef<Brief | undefined>(undefined);
  const nextId = useRef(0);
  const print = useCallback((node: ReactNode) => {
    const id = nextId.current++;
    setEntries((xs) => [...xs, { id, node }]);
  }, []);
  const load = useCallback(
    async (extra: Partial<BriefOptions>, label: string) => {
      setPhase({ tag: "loading", reports: [], label });
      try {
        const b = await build(kind, {
          ...options,
          ...extra,
          onReport: (r) =>
            setPhase((p) => (p.tag === "loading" ? { ...p, reports: [...p.reports, r] } : p)),
        });
        brief.current = b;
        return b;
      } catch (e) {
        return message(e);
      }
    },
    [kind, options],
  );
  const doCopy = useCallback(async (text: string) => {
    const tool = await copyToClipboard(text);
    setFlash(
      tool
        ? { kind: "ok", text: `Copied the standup to the clipboard (${tool}).` }
        : {
            kind: "fail",
            text: "Couldn't copy: no clipboard tool worked. Install wl-clipboard or xclip, or pipe --plain into your own.",
          },
    );
  }, []);
  useEffect(() => {
    void load({}, "Collecting activity").then(async (b) => {
      if ("message" in b) {
        setPhase({ tag: "error", ...b });
        return;
      }
      print(
        <KeysLive.Provider value={interactive}>
          <BriefView brief={b} view={initial} />
        </KeysLive.Provider>,
      );
      setPhase({ tag: "ready" });
      if (copy) await doCopy(b.summary.text);
    });
  }, [load, print, interactive, initial, copy, doCopy]);
  useEffect(() => {
    const leaving =
      phase.tag === "done" || phase.tag === "error" || (!interactive && phase.tag === "ready");
    if (!leaving) return undefined;
    const t = setTimeout(
      () => exit(phase.tag === "error" ? new Error(phase.message) : undefined),
      0,
    );
    return () => clearTimeout(t);
  }, [interactive, phase, exit]);
  const regenerate = useCallback(async () => {
    const before = brief.current;
    const b = await load({ refresh: true }, "Regenerating");
    setPhase({ tag: "ready" });
    if ("message" in b) {
      setFlash({
        kind: "fail",
        text: `Couldn't regenerate: ${b.message}${b.hint ? ` ${b.hint}` : ""}`,
      });
      return;
    }
    print(<Standup brief={b} label="Standup, regenerated" />);
    if (before?.summary.origin === "edited")
      setFlash({ kind: "info", text: "Your edit was discarded." });
  }, [load, print]);
  const edit = useCallback(
    async (b: Brief) => {
      let edited: string | undefined;
      try {
        await suspendTerminal(async () => {
          edited = await editInEditor(b.summary.text);
        });
      } catch (e) {
        setFlash({
          kind: "fail",
          text: `Editor failed: ${message(e).message}. Set $EDITOR to the editor you use.`,
        });
        return;
      }
      if (edited === undefined || edited.trim() === b.summary.text.trim()) {
        setFlash({ kind: "info", text: "No changes." });
        return;
      }
      if (!edited.trim()) {
        setFlash({
          kind: "info",
          text: "The file was empty, so nothing was saved.",
        });
        return;
      }
      const text = edited.trimEnd();
      setBusy("Saving your edit");
      try {
        await runPromise(Effect.flatMap(Briefs, (s) => s.saveEdit(b.key, text)));
        const next: Brief = {
          ...b,
          summary: { text, origin: "edited", cached: true },
        };
        brief.current = next;
        print(<Standup brief={next} label="Standup, edited" />);
        setFlash({
          kind: "ok",
          text: "Saved. Rundown shows your version of this standup from now on.",
        });
      } catch (e) {
        setFlash({
          kind: "fail",
          text: `Couldn't save your edit: ${message(e).message}`,
        });
      } finally {
        setBusy(undefined);
      }
    },
    [suspendTerminal, print],
  );
  const openWeb = useCallback(async () => {
    setBusy("Looking for the web UI");
    try {
      const cfg = await runPromise(RundownConfig);
      const base = `http://localhost:${cfg.schedule.port}`;
      const url = `${base}${webPath(kind, options)}`;
      if (await serverUp(base)) {
        openUrl(url);
        setFlash({ kind: "ok", text: `Opened ${url}` });
      } else {
        setFlash({
          kind: "fail",
          text: (
            <>
              The web UI isn't running on {base}. Start it with <Text bold>rundown serve</Text> in
              another terminal, then press o again.
            </>
          ),
        });
      }
    } catch (e) {
      setFlash({
        kind: "fail",
        text: `Couldn't open the web UI: ${message(e).message}`,
      });
    } finally {
      setBusy(undefined);
    }
  }, [kind, options]);
  useInput(
    (input, key) => {
      if (phase.tag !== "ready" || busy) {
        if (input === "q" || key.escape) setPhase({ tag: "done" });
        return;
      }
      const b = brief.current;
      if (!b) return;
      if (confirm) {
        setConfirm(false);
        if (input === "y" || input === "Y") void regenerate();
        else setFlash({ kind: "info", text: "Kept your edit." });
        return;
      }
      setFlash(undefined);
      switch (input) {
        case "q":
          setPhase({ tag: "done" });
          break;
        case "c":
          void doCopy(b.summary.text);
          break;
        case "e":
          void edit(b);
          break;
        case "r":
          if (b.summary.origin === "edited") setConfirm(true);
          else void regenerate();
          break;
        case "d": {
          const cal = calendarFor(b);
          const long =
            b.plan &&
            [b.plan.authored, b.plan.reviews, b.plan.issues].some((xs) => xs.length > LIST_LIMIT);
          print(
            <>
              {long ? <PlanSections brief={b} cal={cal} details now={new Date()} /> : null}
              <ReceiptSections brief={b} cal={cal} details />
            </>,
          );
          break;
        }
        case "s":
          print(<SourceFooter reports={b.reports} verbose />);
          break;
        case "o":
          void openWeb();
          break;
        default:
          if (key.escape) setPhase({ tag: "done" });
      }
    },
    { isActive: interactive },
  );
  return (
    <>
      <Static items={[...entries]}>
        {(e) => (
          <Box key={e.id} flexDirection="column" width={width}>
            {e.node}
          </Box>
        )}
      </Static>
      <Dynamic
        phase={phase}
        busy={busy}
        confirm={confirm}
        flash={flash}
        keys={interactive && phase.tag === "ready" && !busy && !confirm}
        width={width}
      />
    </>
  );
};
const Dynamic = ({
  phase,
  busy,
  confirm,
  flash,
  keys,
  width,
}: {
  phase: Phase;
  busy: string | undefined;
  confirm: boolean;
  flash: Flash | undefined;
  keys: boolean;
  width: number;
}) => {
  if (phase.tag === "done") return null;
  if (phase.tag === "loading") {
    return (
      <Box marginTop={1} width={width}>
        <Progress reports={phase.reports} label={phase.label} />
      </Box>
    );
  }
  if (phase.tag === "error") {
    return (
      <Box flexDirection="column" width={width}>
        <Notice kind="fail">Couldn't build this brief: {phase.message}</Notice>
        {phase.hint ? (
          <Box paddingLeft={2}>
            <Para dimColor>{phase.hint}</Para>
          </Box>
        ) : null}
      </Box>
    );
  }
  if (!keys && !busy && !confirm && !flash) return null;
  return (
    <Box flexDirection="column" marginTop={1} width={width}>
      {flash ? <Notice kind={flash.kind}>{flash.text}</Notice> : null}
      {busy ? <Spinner label={busy} /> : null}
      {confirm ? (
        <Para>
          <Text bold>Regenerate and discard your edit?</Text>
          <Text dimColor> y to confirm, any other key to keep it</Text>
        </Para>
      ) : null}
      {keys ? <KeyBar width={width} /> : null}
    </Box>
  );
};
