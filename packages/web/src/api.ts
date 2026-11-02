import type {
  Brief,
  BriefKind,
  HistoryDay,
  Meta,
  SourceReport,
  SourcesResponse,
  SourcesTest,
} from "./types";
export class ApiError extends Error {
  readonly status: number;
  readonly hint?: string;
  constructor(message: string, status: number, hint?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (hint) this.hint = hint;
  }
}
const UNREACHABLE = () =>
  new ApiError("Can't reach Rundown.", 0, "Start it again with `rundown serve`, then reload.");
const request = async <A>(path: string, init?: RequestInit): Promise<A> => {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch {
    throw UNREACHABLE();
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (body ?? {}) as {
      error?: unknown;
      hint?: unknown;
    };
    throw new ApiError(
      typeof err.error === "string"
        ? err.error
        : `Request failed (${res.status} ${res.statusText})`,
      res.status,
      typeof err.hint === "string" ? err.hint : undefined,
    );
  }
  return body as A;
};
export interface BriefQuery {
  readonly date?: string;
  readonly last?: boolean;
  readonly refresh?: boolean;
  readonly llm?: boolean;
}
const briefQs = (opts: BriefQuery) => {
  const q = new URLSearchParams();
  if (opts.date) q.set("date", opts.date);
  if (opts.last) q.set("last", "1");
  if (opts.refresh) q.set("refresh", "1");
  if (opts.llm === false) q.set("llm", "0");
  const qs = q.toString();
  return qs ? `?${qs}` : "";
};
export const getMeta = () => request<Meta>("/api/meta");
export const streamBrief = (
  kind: BriefKind,
  opts: BriefQuery,
  onReport: (r: SourceReport) => void,
  signal: AbortSignal,
): Promise<Brief> =>
  new Promise((resolve, reject) => {
    const source = new EventSource(`/api/brief/${kind}/stream${briefQs(opts)}`);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      source.close();
      fn();
    };
    signal.addEventListener("abort", () =>
      finish(() => reject(new DOMException("aborted", "AbortError"))),
    );
    source.addEventListener("report", (e) =>
      onReport(JSON.parse((e as MessageEvent<string>).data) as SourceReport),
    );
    source.addEventListener("brief", (e) =>
      finish(() => resolve(JSON.parse((e as MessageEvent<string>).data) as Brief)),
    );
    source.addEventListener("error", (e) => {
      const data = (e as MessageEvent<string | undefined>).data;
      if (data) {
        const err = JSON.parse(data) as {
          error: string;
          hint?: string;
        };
        finish(() => reject(new ApiError(err.error, 500, err.hint)));
      } else {
        finish(() => reject(UNREACHABLE()));
      }
    });
  });
export const saveEdit = (key: string, text: string) =>
  request<{
    ok: true;
  }>("/api/brief/edit", {
    method: "PUT",
    body: JSON.stringify({ key, text }),
  });
export const revertEdit = (key: string) =>
  request<{
    ok: true;
  }>(`/api/brief/edit?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
export const getSources = () => request<SourcesResponse>("/api/sources");
export const testSources = () => request<SourcesTest>("/api/sources/test", { method: "POST" });
export const getHistory = (days = 30) => request<HistoryDay[]>(`/api/history?days=${days}`);
export const collectHistory = (days = 30) =>
  request<{
    activities: number;
    reports: SourceReport[];
  }>(`/api/history/collect?days=${days}`, { method: "POST" });
