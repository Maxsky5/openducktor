import type { KanbanColumn as KanbanColumnData } from "@openducktor/core";
import type { ReactElement } from "react";
import {
  KANBAN_COLLAPSED_LANE_WIDTH_CLASS,
  KANBAN_LANE_HEADER_HEIGHT_CLASS,
} from "@/components/features/kanban/kanban-layout";
import { laneTheme } from "@/components/features/kanban/kanban-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type KanbanCollapsedColumnProps = {
  column: KanbanColumnData;
};

export function KanbanCollapsedColumn({ column }: KanbanCollapsedColumnProps): ReactElement {
  const theme = laneTheme(column.id);
  const label = `${column.title} column is empty and collapsed`;
  const accentClass = theme.collapsedAccentClass ?? theme.headerAccentClass;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "group flex min-h-96 cursor-default flex-col overflow-hidden rounded-2xl border p-0 text-left shadow-sm transition-[background-color,border-color,box-shadow] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            KANBAN_COLLAPSED_LANE_WIDTH_CLASS,
            theme.boardSurfaceClass,
          )}
        >
          <span
            className={cn(
              "flex w-full flex-col items-center justify-between border-b border-border/80 px-1.5 pb-3 pt-4",
              KANBAN_LANE_HEADER_HEIGHT_CLASS,
              theme.headerSurfaceClass,
            )}
          >
            <span className={cn("block h-1.5 w-4 rounded-full", accentClass)} />
            <span className="flex h-6 items-center justify-center">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-background shadow-sm ring-2 ring-background",
                  accentClass,
                )}
                aria-hidden="true"
              >
                0
              </span>
            </span>
          </span>
          <span className="flex w-full flex-1 flex-col items-center px-1.5 py-3">
            <span
              className={cn(
                "mt-2 w-1 flex-1 rounded-full opacity-25 transition-opacity group-hover:opacity-45",
                accentClass,
              )}
              aria-hidden="true"
            />
          </span>
          <span className="sr-only">No tasks in this lane.</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={10} className="flex flex-col gap-1 px-3 py-2">
        <p className="text-sm font-semibold text-background">{column.title}</p>
        <p className="text-xs font-medium text-background/75">Collapsed empty lane</p>
      </TooltipContent>
    </Tooltip>
  );
}
