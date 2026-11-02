import { AlertTriangleIcon, CheckIcon, MinusIcon } from "lucide-react";
import { formatDuration } from "../lib/time";
import { hrefFor, Link } from "../lib/router";
import type { SourceReport, SourceStatus } from "../types";
const MARK: Record<
  SourceStatus,
  {
    icon: typeof CheckIcon;
    word: string;
    tone: string;
  }
> = {
  ok: { icon: CheckIcon, word: "OK", tone: "text-content-secondary" },
  skipped: { icon: MinusIcon, word: "Off", tone: "text-content-tertiary" },
  failed: { icon: AlertTriangleIcon, word: "Failed", tone: "text-danger" },
};
export const StatusMark = ({ status }: { status: SourceStatus }) => {
  const m = MARK[status];
  return (
    <span className={`inline-flex items-center gap-1 text-caption ${m.tone}`}>
      <m.icon aria-hidden className="size-3.5" strokeWidth={2.25} />
      {m.word}
    </span>
  );
};
export const SourceFooter = ({ reports }: { reports: readonly SourceReport[] }) => {
  const ok = reports.filter((r) => r.status === "ok");
  const failed = reports.filter((r) => r.status === "failed");
  const items = ok.reduce((n, r) => n + r.count, 0);
  return (
    <footer className="space-y-1.5 border-hairline border-t pt-4 text-caption text-content-tertiary">
      <p>
        Built from {items} {items === 1 ? "item" : "items"} across {ok.length} of {reports.length}{" "}
        sources ·{" "}
        <Link href={hrefFor("sources")} className="underline underline-offset-2 hover:text-content">
          Sources
        </Link>
      </p>
      {failed.map((r) => (
        <p key={r.id} className="flex gap-1.5 text-danger">
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {r.label} failed: {r.detail}
            {r.hint && <span className="text-content-secondary"> {r.hint}</span>}
          </span>
        </p>
      ))}
    </footer>
  );
};
export const ReportTable = ({ reports }: { reports: readonly SourceReport[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[34rem] text-left text-ui">
      <caption className="sr-only">Result of the latest fetch from each source</caption>
      <thead className="text-caption text-content-tertiary">
        <tr className="border-hairline border-b">
          <th scope="col" className="py-2 pr-4 font-medium">
            Source
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Status
          </th>
          <th scope="col" className="py-2 pr-4 text-right font-medium">
            Items
          </th>
          <th scope="col" className="py-2 pr-4 text-right font-medium">
            Time
          </th>
          <th scope="col" className="py-2 font-medium">
            Detail
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline">
        {reports.map((r) => (
          <tr key={r.id} className="align-baseline">
            <th scope="row" className="py-2 pr-4 font-medium">
              {r.label}
            </th>
            <td className="py-2 pr-4">
              <StatusMark status={r.status} />
            </td>
            <td className="py-2 pr-4 text-right font-mono text-caption tabular-nums">
              {r.status === "ok" ? r.count : ""}
            </td>
            <td className="py-2 pr-4 text-right font-mono text-caption text-content-tertiary tabular-nums">
              {r.durationMs ? formatDuration(r.durationMs) : ""}
            </td>
            <td className="py-2 text-caption text-content-secondary">
              {r.detail}
              {r.hint && <span className="block text-content-tertiary">{r.hint}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
