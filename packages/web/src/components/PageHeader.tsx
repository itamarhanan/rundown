import { type ReactNode, useEffect, useRef } from "react";
let initialLoad = true;
export const PageHeader = ({
  title,
  subtitle,
  actions,
  routeKey,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  routeKey: string;
}) => {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · Rundown`;
    if (initialLoad) {
      initialLoad = false;
      return;
    }
    window.scrollTo({ top: 0 });
    ref.current?.focus({ preventScroll: true });
  }, [routeKey, title]);
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1
          ref={ref}
          tabIndex={-1}
          className="font-semibold text-title tracking-tight outline-none"
        >
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-content-secondary text-ui">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </header>
  );
};
