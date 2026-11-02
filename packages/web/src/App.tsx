import {
  ArchiveIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarRangeIcon,
  type LucideIcon,
  PlugIcon,
  SunriseIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getMeta } from "./api";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/skeleton";
import { hrefFor, Link, useRoute, type View } from "./lib/router";
import { cn } from "./lib/utils";
import type { BriefKind, Meta } from "./types";
import { BriefPage } from "./views/BriefPage";
import { HistoryPage } from "./views/HistoryPage";
import { SourcesPage } from "./views/SourcesPage";
const NAV: readonly {
  group: string;
  items: readonly {
    view: View;
    label: string;
    icon: LucideIcon;
  }[];
}[] = [
  {
    group: "Briefs",
    items: [
      { view: "morning", label: "Morning", icon: SunriseIcon },
      { view: "yesterday", label: "Yesterday", icon: CalendarCheckIcon },
      { view: "today", label: "Today", icon: CalendarClockIcon },
      { view: "week", label: "Week", icon: CalendarRangeIcon },
    ],
  },
  {
    group: "Library",
    items: [
      { view: "history", label: "History", icon: ArchiveIcon },
      { view: "sources", label: "Sources", icon: PlugIcon },
    ],
  },
];
export const App = () => {
  const route = useRoute();
  const [meta, setMeta] = useState<Meta | undefined>();
  const [error, setError] = useState<
    | {
        message: string;
        hint?: string;
      }
    | undefined
  >();
  const loadMeta = () => {
    setError(undefined);
    getMeta()
      .then(setMeta)
      .catch(
        (
          e: Error & {
            hint?: string;
          },
        ) => setError({ message: e.message, ...(e.hint ? { hint: e.hint } : {}) }),
      );
  };
  useEffect(loadMeta, []);
  useEffect(() => {
    if (window.location.pathname === "/")
      window.history.replaceState(null, "", hrefFor("morning") + window.location.search);
  }, []);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-content px-3 py-2 text-surface focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Sidebar current={route.view} meta={meta} />
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 px-5 pt-6 pb-16 outline-none sm:px-8 md:pt-10 lg:px-12"
      >
        <div className="mx-auto max-w-3xl">
          {error ? (
            <div role="alert" className="space-y-2 pt-10">
              <h1 className="font-semibold text-title">{error.message}</h1>
              {error.hint && <p className="text-content-secondary text-ui">{error.hint}</p>}
              <Button variant="outline" size="sm" className="mt-3" onClick={loadMeta}>
                Try again
              </Button>
            </div>
          ) : !meta ? (
            <div className="space-y-4" aria-busy>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : route.view === "history" ? (
            <HistoryPage />
          ) : route.view === "sources" ? (
            <SourcesPage meta={meta} />
          ) : (
            <BriefPage
              key={`${route.view}?${route.params.toString()}`}
              kind={route.view as BriefKind}
              params={route.params}
              meta={meta}
            />
          )}
        </div>
      </main>
    </div>
  );
};
const Sidebar = ({ current, meta }: { current: View; meta: Meta | undefined }) => (
  <aside className="border-hairline border-b bg-surface-sunken md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-r md:border-b-0">
    <div className="flex items-baseline justify-between px-5 pt-4 md:px-5 md:pt-6">
      <Link href={hrefFor("morning")} className="font-semibold text-ui tracking-tight">
        rundown
      </Link>
      {meta && (
        <span className="font-mono text-caption text-content-tertiary">v{meta.version}</span>
      )}
    </div>

    <nav aria-label="Sections" className="mt-2 md:mt-6 md:flex-1">
      <div className="flex gap-1 overflow-x-auto px-3 pb-2 md:block md:space-y-6 md:overflow-visible md:pb-0">
        {NAV.map((g) => (
          <div key={g.group} className="contents md:block">
            <p className="hidden px-2 pb-1.5 font-medium text-caption text-content-tertiary md:block">
              {g.group}
            </p>
            <ul className="contents md:block md:space-y-0.5">
              {g.items.map((item) => {
                const active = current === item.view;
                return (
                  <li key={item.view} className="shrink-0">
                    <Link
                      href={hrefFor(item.view)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-content-secondary text-ui hover:bg-fill-hover hover:text-content md:min-h-8",
                        active && "bg-fill-hover font-medium text-content",
                      )}
                    >
                      <item.icon aria-hidden className="size-4" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>

    {meta && (
      <div className="hidden space-y-1 border-hairline border-t px-5 py-4 text-caption md:block">
        <p className="font-medium text-content">{meta.user.name}</p>
        <p className="text-content-tertiary">{meta.user.timeZone}</p>
        <p className="text-content-tertiary">
          {meta.llm.ok ? (
            <>
              Writing with{" "}
              <span className="font-mono">{meta.llm.model.split("/").slice(-1)[0]}</span>
            </>
          ) : (
            "Plain digest, no LLM"
          )}
        </p>
      </div>
    )}
  </aside>
);
