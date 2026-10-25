import { ChevronDown } from "lucide-react";
import { Activity, type ReactElement, type ReactNode, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

type CollapsibleCardProps = {
  title: string;
  icon: ReactElement;
  /** Short text beside the title, such as a count or a date. */
  summary?: string | null;
  defaultExpanded?: boolean;
  /** Controls at the end of the header. A click on them does not toggle the card. */
  headerAction?: ReactNode;
  children?: ReactNode;
  renderChildren?: (context: { isExpanded: boolean }) => ReactNode;
};

/**
 * A card section with a header that expands and collapses it.
 * The trigger covers the full header. Header actions stay above it.
 * A closed card keeps its content state in a hidden `Activity`, which pauses its effects.
 */
export function CollapsibleCard({
  title,
  icon,
  summary = null,
  defaultExpanded = false,
  headerAction,
  children,
  renderChildren,
}: CollapsibleCardProps): ReactElement {
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const isExpanded = expandedOverride ?? defaultExpanded;
  const resolvedChildren = renderChildren === undefined ? children : renderChildren({ isExpanded });

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setExpandedOverride}
      className="group/card rounded-xl border border-border/90 bg-card shadow-sm"
    >
      <div className="relative flex min-h-10 items-center gap-2 rounded-xl px-3 py-1.5 transition-colors hover:bg-muted/60 group-data-[state=open]/card:rounded-b-none">
        <h3 className="min-w-0 flex-1">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full min-w-0 cursor-pointer items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none after:absolute after:inset-0 after:rounded-xl group-data-[state=open]/card:after:rounded-b-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
            >
              {icon}
              <span className="truncate">{title}</span>
              {summary ? (
                <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-foreground">
                  {summary}
                </span>
              ) : null}
            </button>
          </CollapsibleTrigger>
        </h3>
        {headerAction ? (
          <div className="relative flex shrink-0 items-center gap-1">{headerAction}</div>
        ) : null}
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]/card:rotate-180"
        />
      </div>

      <CollapsibleContent forceMount className="px-3 pb-3 data-[state=closed]:hidden">
        <Activity mode={isExpanded ? "visible" : "hidden"}>{resolvedChildren}</Activity>
      </CollapsibleContent>
    </Collapsible>
  );
}
