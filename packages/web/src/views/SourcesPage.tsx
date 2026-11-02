import { useCallback, useEffect, useState } from "react";
import { getSources, testSources } from "../api";
import { LedgerSection } from "../components/common";
import { PageHeader } from "../components/PageHeader";
import { ReportTable, StatusMark } from "../components/SourceHealth";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { relativeTime } from "../lib/time";
import type { Meta, SourceReport, SourcesResponse } from "../types";
const DELIVERY: Record<Meta["schedule"]["delivery"], string> = {
  notification: "desktop notification",
  web: "notification that opens this page",
  terminal: "notification that opens the terminal view",
  file: "Markdown file",
};
export const SourcesPage = ({ meta }: { meta: Meta }) => {
  const [data, setData] = useState<SourcesResponse | undefined>();
  const [tested, setTested] = useState<
    | {
        at: string;
        reports: readonly SourceReport[];
      }
    | undefined
  >();
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const load = useCallback(() => {
    getSources()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  const test = async () => {
    setTesting(true);
    setError(undefined);
    try {
      const r = await testSources();
      setTested({ at: new Date().toISOString(), reports: r.reports });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };
  const latest = tested ?? data?.last ?? undefined;
  return (
    <div className="space-y-10">
      <PageHeader
        title="Sources"
        subtitle="Where your activity comes from. Everything stays on this machine except calls to the APIs you configure."
        routeKey="sources"
        actions={
          <Button variant="outline" size="sm" onClick={() => void test()} loading={testing}>
            Test all sources
          </Button>
        }
      />

      {error && (
        <p role="alert" className="text-danger text-ui">
          {error}
        </p>
      )}

      <LedgerSection
        id="last-fetch"
        label="Last fetch"
        aside={latest ? relativeTime(latest.at) : undefined}
      >
        <p role="status" aria-live="polite" className="sr-only">
          {testing ? "Testing every source" : tested ? "Test finished" : ""}
        </p>
        {latest ? (
          <ReportTable reports={latest.reports} />
        ) : (
          <p className="text-content-tertiary text-ui">
            No fetch since Rundown started. Open a brief, or test all sources.
          </p>
        )}
      </LedgerSection>

      <LedgerSection id="detected" label="Detected">
        {!data ? (
          <div className="space-y-2" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {data.sources.map((s) => (
              <li
                key={s.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[9rem_4rem_minmax(0,1fr)]"
              >
                <span className="font-medium text-ui">{s.label}</span>
                <StatusMark status={s.detection.available ? "ok" : "skipped"} />
                <span className="col-span-2 min-w-0 wrap-break-word text-caption text-content-secondary sm:col-span-1">
                  {s.detection.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </LedgerSection>

      <LedgerSection id="settings" label="Settings">
        <dl className="grid gap-x-4 gap-y-0.5 text-ui sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-y-2">
          <dt className="mt-1.5 text-content-secondary first:mt-0 sm:mt-0">Writing</dt>
          <dd>
            {meta.llm.ok ? (
              <span className="font-mono text-caption">{meta.llm.model}</span>
            ) : (
              <>Plain digest. {meta.llm.reason}</>
            )}
          </dd>
          <dt className="mt-1.5 text-content-secondary first:mt-0 sm:mt-0">Morning brief</dt>
          <dd>
            {meta.schedule.morningBrief} on workdays, as a {DELIVERY[meta.schedule.delivery]}.{" "}
            <span className="text-content-tertiary">
              Runs while <code className="font-mono text-caption">rundown daemon</code> is running.
            </span>
          </dd>
          <dt className="mt-1.5 text-content-secondary first:mt-0 sm:mt-0">Time zone</dt>
          <dd>{meta.user.timeZone}</dd>
          <dt className="mt-1.5 text-content-secondary first:mt-0 sm:mt-0">Config</dt>
          <dd className="break-all font-mono text-caption">{meta.paths.config}</dd>
          <dt className="mt-1.5 text-content-secondary first:mt-0 sm:mt-0">Data</dt>
          <dd className="break-all font-mono text-caption">{meta.paths.data}</dd>
        </dl>
        <p className="mt-4 text-caption text-content-tertiary">
          Change settings with <code className="font-mono">rundown config --edit</code>. API keys
          come from your shell environment and are never written to the config.
        </p>
      </LedgerSection>
    </div>
  );
};
