import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { humanDate } from "@/lib/task-display";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";

type TaskDetailsCollapsibleCardProps = {
  title: string;
  icon: ReactElement;
  updatedAt?: string | null;
  statusLabel?: string | null;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: ReactNode | ((context: { isExpanded: boolean }) => ReactNode);
};

export function TaskDetailsCollapsibleCard({
  title,
  icon,
  updatedAt = null,
  statusLabel = null,
  defaultExpanded = false,
  onExpandedChange,
  children,
}: TaskDetailsCollapsibleCardProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const summaryLabel = statusLabel ?? (updatedAt ? humanDate(updatedAt) : null);

  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const resolvedChildren = typeof children === "function" ? children({ isExpanded }) : children;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={(nextOpen) => {
        setIsExpanded(nextOpen);
        onExpandedChange?.(nextOpen);
      }}
      className="rounded-xl border border-slate-200/90 bg-white shadow-sm"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md p-4 text-left outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500/40"
        >
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            {icon}
            {title}
          </h4>
          <span className="inline-flex items-center gap-2">
            {summaryLabel ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                {summaryLabel}
              </span>
            ) : null}
            <ChevronDown
              className={cn(
                "size-3.5 text-slate-500 transition-transform duration-150",
                isExpanded ? "rotate-180" : "rotate-0",
              )}
            />
          </span>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent
        forceMount
        className="overflow-hidden data-[state=closed]:hidden px-4 pb-4"
      >
        <div className="space-y-3 pt-3">{resolvedChildren}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
