import type { RuntimeKind, UsageFigure } from "@openducktor/contracts";
import { TriangleAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatMetric,
  formatTableMetric,
  missingReason,
  shownValue,
  USAGE_RUNTIME_COLORS,
  type UsageMetric,
} from "./usage-format";

/** Text that explains itself on hover and keyboard focus. */
export function Explained({
  text,
  children,
  className,
}: {
  text: string;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The trigger takes focus, so keyboard users can read the reason too. */}
        <span tabIndex={0} aria-label={text} className={cn("cursor-help outline-none", className)}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

const INCOMPLETE_TEXT =
  "Some history of this range could not be read, so this value can be higher.";

/** A warning mark for a figure that unread history can make too low. */
export function IncompleteMark({ figure }: { figure: UsageFigure }): ReactElement | null {
  if (figure.complete) return null;
  return (
    <Explained text={INCOMPLETE_TEXT} className="inline-flex text-warning-muted">
      <TriangleAlert className="size-3.5" aria-hidden="true" />
    </Explained>
  );
}

/** The value of a figure, or a dash that gives its reason when the figure has no value. */
export function MetricValue({
  figure,
  metric,
  exact = false,
}: {
  figure: UsageFigure;
  metric: UsageMetric;
  /** Cents for amounts, as table cells show them. */
  exact?: boolean;
}): ReactElement {
  const value = shownValue(figure, metric);
  const reason = missingReason(figure, metric);
  if (value === null)
    return (
      <Explained text={reason ?? ""} className="text-muted-foreground">
        —
      </Explained>
    );
  return <>{exact ? formatTableMetric(value, metric) : formatMetric(value, metric)}</>;
}

export function RuntimeDot({ runtime }: { runtime: RuntimeKind }): ReactElement {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ background: USAGE_RUNTIME_COLORS[runtime] }}
      aria-hidden="true"
    />
  );
}

/** The heading of a page section, with an optional control on its right. */
export function SectionHeading({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {action}
    </div>
  );
}
