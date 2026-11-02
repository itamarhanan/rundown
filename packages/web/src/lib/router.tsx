import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";
import { type BriefKind, BriefKinds } from "../types";
export type View = BriefKind | "history" | "sources";
export const Views: readonly View[] = [...BriefKinds, "history", "sources"];
export interface Route {
  readonly view: View;
  readonly params: URLSearchParams;
}
const NAV_EVENT = "rundown:navigate";
const subscribe = (fn: () => void) => {
  window.addEventListener("popstate", fn);
  window.addEventListener(NAV_EVENT, fn);
  return () => {
    window.removeEventListener("popstate", fn);
    window.removeEventListener(NAV_EVENT, fn);
  };
};
const snapshot = () => window.location.pathname + window.location.search;
export const parseRoute = (href: string): Route => {
  const url = new URL(href, window.location.origin);
  const seg = url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
  const view = (Views as readonly string[]).includes(seg) ? (seg as View) : "morning";
  return { view, params: url.searchParams };
};
export const useRoute = (): Route => parseRoute(useSyncExternalStore(subscribe, snapshot));
export const navigate = (href: string, { replace = false } = {}) => {
  if (href === snapshot()) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", href);
  window.dispatchEvent(new Event(NAV_EVENT));
};
export const hrefFor = (view: View, params: Record<string, string | undefined> = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const qs = q.toString();
  return `/${view}${qs ? `?${qs}` : ""}`;
};
export const Link = ({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
}) => (
  <a
    href={href}
    onClick={(e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      e.preventDefault();
      navigate(href);
    }}
    {...props}
  />
);
