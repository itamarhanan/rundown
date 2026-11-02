import { ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { collectHistory, getHistory } from "../api";
import { Facts } from "../components/common";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { plural } from "../lib/activity";
import { hrefFor, Link } from "../lib/router";
import type { HistoryDay } from "../types";
const DAYS = 30;
export const HistoryPage = () => {
  const [days, setDays] = useState<HistoryDay[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState<string | undefined>();
  const load = useCallback(() => {
    setError(undefined);
    getHistory(DAYS)
      .then(setDays)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  const backfill = async () => {
    setCollecting(true);
    setCollected(undefined);
    try {
      const r = await collectHistory(DAYS);
      setCollected(`Collected ${plural(r.activities, "item")} from the last ${DAYS} days.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCollecting(false);
    }
  };
  const max = Math.max(1, ...(days ?? []).map((d) => d.count));
  return (
    <div className="space-y-8">
      <PageHeader
        title="History"
        subtitle={`The last ${DAYS} days Rundown has collected. Open a day to see its standup.`}
        routeKey="history"
        actions={
          <Button variant="outline" size="sm" onClick={() => void backfill()} loading={collecting}>
            Collect last {DAYS} days
          </Button>
        }
      />

      <p role="status" aria-live="polite" className="text-content-secondary text-ui empty:hidden">
        {collecting ? "Fetching from every source. This can take a minute." : collected}
      </p>
      {error && (
        <p role="alert" className="text-danger text-ui">
          {error}
        </p>
      )}

      {!days && !error && (
        <div className="space-y-3" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {days && days.length === 0 && (
        <div className="max-w-prose space-y-2 text-ui">
          <p className="font-medium">No history yet</p>
          <p className="text-content-secondary">
            Rundown keeps what it collects for each brief on this machine. Collect the last {DAYS}{" "}
            days to fill this in now.
          </p>
        </div>
      )}

      {days && days.length > 0 && (
        <ol className="divide-y divide-hairline border-hairline border-y">
          {days.map((d) => (
            <li key={d.key}>
              <Link
                href={hrefFor("yesterday", { date: d.key })}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-x-4 py-3 hover:bg-fill/60 sm:grid-cols-[6.5rem_8rem_minmax(0,1fr)_auto]"
              >
                <span className="font-medium text-ui">{d.label}</span>
                <span className="hidden items-center gap-2 sm:flex" aria-hidden>
                  <span
                    className="h-1.5 rounded-full bg-content-tertiary/70"
                    style={{ width: `${(d.count / max) * 100}%` }}
                  />
                </span>
                <span className="min-w-0 truncate">
                  <Facts
                    items={[
                      plural(d.count, "item"),
                      d.meetings > 0 && plural(d.meetings, "meeting"),
                      d.projects.map((p) => p.project).join(", "),
                    ]}
                  />
                </span>
                <ChevronRightIcon aria-hidden className="size-4 text-content-tertiary" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
