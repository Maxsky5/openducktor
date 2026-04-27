import type { KanbanColumn as KanbanColumnData } from "@openducktor/core";
import type { ReactElement } from "react";
import { KANBAN_COLLAPSED_LANE_WIDTH_CLASS } from "@/components/features/kanban/kanban-layout";
import { laneTheme } from "@/components/features/kanban/kanban-theme";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type KanbanCollapsedColumnProps = {
  column: KanbanColumnData;
};

export function KanbanCollapsedColumn({ column }: KanbanCollapsedColumnProps): ReactElement {
  const theme = laneTheme(column.id);
  const label = `${column.title} column is empty and collapsed`;
  const accentClass = column.id === "open" ? "bg-muted-foreground/45" : theme.headerAccentClass;

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <section
            aria-label={label}
            title={label}
            className={cn(
              "group flex min-h-96 flex-col items-center rounded-full border px-1.5 py-3 shadow-sm transition-[background-color,border-color,box-shadow] hover:shadow-md",
              KANBAN_COLLAPSED_LANE_WIDTH_CLASS,
              theme.boardSurfaceClass,
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-background shadow-sm ring-2 ring-background",
                accentClass,
              )}
              aria-hidden="true"
            >
              0
            </span>
            <span
              className={cn("mt-3 h-12 w-1 rounded-full opacity-80", accentClass)}
              aria-hidden="true"
            />
            <span
              className={cn(
                "mt-2 w-1 flex-1 rounded-full opacity-25 transition-opacity group-hover:opacity-45",
                accentClass,
              )}
              aria-hidden="true"
            />
            <span className="sr-only">No tasks in this lane.</span>
          </section>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={10} className="flex flex-col gap-1 px-3 py-2">
          <p className="text-sm font-semibold text-background">{column.title}</p>
          <p className="text-xs font-medium text-background/75">Collapsed empty lane</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
