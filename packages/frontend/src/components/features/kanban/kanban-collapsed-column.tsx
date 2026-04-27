import type { KanbanColumn as KanbanColumnData } from "@openducktor/core";
import type { ReactElement } from "react";
import { KANBAN_COLLAPSED_LANE_WIDTH_CLASS } from "@/components/features/kanban/kanban-layout";
import { laneTheme } from "@/components/features/kanban/kanban-theme";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type KanbanCollapsedColumnProps = {
  column: KanbanColumnData;
};

export function KanbanCollapsedColumn({ column }: KanbanCollapsedColumnProps): ReactElement {
  const theme = laneTheme(column.id);
  const label = `${column.title} column is empty and collapsed`;

  return (
    <section
      aria-label={label}
      title={label}
      className={cn(
        "flex min-h-96 flex-col overflow-hidden rounded-2xl border shadow-sm",
        KANBAN_COLLAPSED_LANE_WIDTH_CLASS,
        theme.boardSurfaceClass,
      )}
    >
      <div className={cn("border-b border-border/60 p-3", theme.headerSurfaceClass)}>
        <span
          className={cn("mb-3 block h-1.5 w-10 rounded-full", theme.headerAccentClass)}
          aria-hidden="true"
        />
        <h3 className="text-sm font-semibold leading-snug text-foreground">{column.title}</h3>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Badge
          variant="outline"
          className={cn(
            "w-fit rounded-full px-2 py-0.5 text-[11px] font-medium",
            theme.countBadgeClass,
          )}
        >
          0 tasks
        </Badge>
        <p className="text-xs leading-relaxed text-muted-foreground">Empty lane</p>
        <p className="sr-only">No tasks in this lane.</p>
      </div>
    </section>
  );
}
