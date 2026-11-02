import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type BriefQuery, streamBrief } from "../api";
import type { Brief, BriefKind, SourceReport } from "../types";
export type BriefState =
  | {
      readonly tag: "loading";
      readonly reports: readonly SourceReport[];
    }
  | {
      readonly tag: "ready";
      readonly brief: Brief;
      readonly refreshing: boolean;
    }
  | {
      readonly tag: "error";
      readonly message: string;
      readonly hint?: string;
    };
export const useBrief = (kind: BriefKind, query: BriefQuery) => {
  const [state, setState] = useState<BriefState>({ tag: "loading", reports: [] });
  const controller = useRef<AbortController | undefined>(undefined);
  const { date, last } = query;
  const load = useCallback(
    (
      extra: {
        refresh?: boolean;
        keep?: boolean;
      } = {},
    ) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      setState((s) =>
        extra.keep && s.tag === "ready"
          ? { ...s, refreshing: true }
          : { tag: "loading", reports: [] },
      );
      streamBrief(
        kind,
        {
          ...(date ? { date } : {}),
          ...(last ? { last } : {}),
          ...(extra.refresh ? { refresh: true } : {}),
        },
        (r) =>
          setState((s) =>
            s.tag === "loading" ? { tag: "loading", reports: [...s.reports, r] } : s,
          ),
        ac.signal,
      )
        .then((brief) => setState({ tag: "ready", brief, refreshing: false }))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setState({
            tag: "error",
            message: e instanceof Error ? e.message : String(e),
            ...(e instanceof ApiError && e.hint ? { hint: e.hint } : {}),
          });
        });
    },
    [kind, date, last],
  );
  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, [load]);
  return {
    state,
    reload: () => load({ keep: true }),
    regenerate: () => load({ keep: true, refresh: true }),
    retry: () => load(),
  };
};
