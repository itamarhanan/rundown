import { AlertTriangleIcon, CheckIcon, CircleIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Urgency } from "../lib/activity";
import { cn } from "../lib/utils";
export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => (
  <kbd
    className={cn(
      "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-hairline bg-fill px-1 font-sans text-caption text-content-secondary leading-none",
      className,
    )}
  >
    {children}
  </kbd>
);
export const LedgerSection = ({
  id,
  label,
  aside,
  children,
  className,
}: {
  id: string;
  label: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section
    aria-labelledby={id}
    className={cn("grid gap-x-8 gap-y-2 md:grid-cols-[7.5rem_minmax(0,1fr)]", className)}
  >
    <div className="flex items-baseline justify-between gap-3 md:block md:pt-0.5">
      <h2
        id={id}
        className="font-semibold text-caption text-content-secondary uppercase tracking-wide"
      >
        {label}
      </h2>
      {aside && <div className="text-caption text-content-tertiary md:mt-1">{aside}</div>}
    </div>
    <div className="min-w-0">{children}</div>
  </section>
);
const URGENCY_ICON: Record<Urgency, LucideIcon> = {
  danger: AlertTriangleIcon,
  warning: AlertTriangleIcon,
  success: CheckIcon,
  neutral: CircleIcon,
};
const URGENCY_TEXT: Record<Urgency, string> = {
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
  neutral: "text-content-tertiary",
};
export const StatusText = ({ urgency, children }: { urgency: Urgency; children: ReactNode }) => {
  const Icon = URGENCY_ICON[urgency];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-caption",
        URGENCY_TEXT[urgency],
      )}
    >
      <Icon
        aria-hidden
        className={cn("size-3.5", urgency === "neutral" && "size-2.5")}
        strokeWidth={2.25}
      />
      {children}
    </span>
  );
};
export const Empty = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-content-tertiary text-ui">
    <p>{children}</p>
    {action}
  </div>
);
export const Facts = ({
  items,
  className,
}: {
  items: readonly ReactNode[];
  className?: string;
}) => {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-1.5 text-caption text-content-tertiary",
        className,
      )}
    >
      {shown.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {item}
        </span>
      ))}
    </span>
  );
};
