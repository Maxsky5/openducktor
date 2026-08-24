import { ChevronDown } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { humanDate } from "@/lib/task-display";
import { cn } from "@/lib/utils";

type TaskDetailsCollapsibleCardProps = {
  title: string;
  icon: ReactElement;
  updatedAt?: string | null;
  statusLabel?: string | null;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  headerAction?: ReactElement;
  children: ReactNode | ((context: { isExpanded: boolean }) => ReactNode);
};

export function TaskDetailsCollapsibleCard({
  title,
  icon,
  updatedAt = null,
  statusLabel = null,
  defaultExpanded = false,
  onExpandedChange,
  headerAction,
  children,
}: TaskDetailsCollapsibleCardProps): ReactElement {
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const summaryLabel = statusLabel ?? (updatedAt ? humanDate(updatedAt) : null);
  const isExpanded = expandedOverride ?? defaultExpanded;

  const resolvedChildren = typeof children === "function" ? children({ isExpanded }) : children;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={(nextOpen) => {
        setExpandedOverride(nextOpen);
        onExpandedChange?.(nextOpen);
      }}
      className="rounded-xl border border-border/90 bg-card shadow-sm"
    >
      <div className="group flex w-full items-center rounded-md p-4 transition hover:bg-muted focus-within:ring-2 focus-within:ring-ring/40">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 text-left outline-none"
          >
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {icon}
              {title}
            </h4>
            <span className="inline-flex items-center gap-2">
              {summaryLabel ? (
                <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                  {summaryLabel}
                </span>
              ) : null}
            </span>
          </button>
        </CollapsibleTrigger>
        <span className="inline-flex items-center gap-2 pl-2">
          {headerAction}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={isExpanded ? "Collapse section" : "Expand section"}
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-150",
                  isExpanded ? "rotate-180" : "rotate-0",
                )}
              />
            </button>
          </CollapsibleTrigger>
        </span>
      </div>

      <CollapsibleContent
        forceMount
        className="overflow-hidden data-[state=closed]:hidden px-4 pb-4"
      >
        <div className="space-y-3 pt-3">{resolvedChildren}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
