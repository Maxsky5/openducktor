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
        "flex min-h-96 flex-col items-center overflow-hidden rounded-2xl border shadow-sm",
        KANBAN_COLLAPSED_LANE_WIDTH_CLASS,
        theme.boardSurfaceClass,
      )}
    >
      <span
        className={cn("block h-16 w-full shrink-0", theme.headerAccentClass)}
        aria-hidden="true"
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-between gap-3 px-2 py-4">
        <Badge
          variant="outline"
          className={cn("h-6 rounded-full px-2 text-[11px] font-semibold", theme.countBadgeClass)}
        >
          0
        </Badge>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="origin-center rotate-180 text-nowrap text-xs font-semibold uppercase tracking-wide text-foreground [writing-mode:vertical-rl]">
            {column.title}
          </p>
        </div>
        <p className="sr-only">No tasks in this lane.</p>
      </div>
    </section>
  );
}
