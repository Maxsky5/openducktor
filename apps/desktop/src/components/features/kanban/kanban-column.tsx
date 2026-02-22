import type { RunSummary } from "@openducktor/contracts";
import type { KanbanColumn as KanbanColumnData, KanbanColumnId } from "@openducktor/core";
import { Inbox } from "lucide-react";
import type { ReactElement } from "react";
import { KanbanTaskCard } from "@/components/features/kanban/kanban-task-card";
import { laneTheme } from "@/components/features/kanban/kanban-theme";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type KanbanColumnProps = {
  column: KanbanColumnData;
  runStateByTaskId: Map<string, RunSummary["state"]>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
};

const laneCountLabel = (count: number): string => (count === 1 ? "1 task" : `${count} tasks`);

function LaneHeader({
  id,
  title,
  count,
}: {
  id: KanbanColumnId;
  title: string;
  count: number;
}): ReactElement {
  const theme = laneTheme(id);
  return (
    <header
      className={cn(
        "space-y-3 border-b border-slate-200/80 px-4 pb-3 pt-4",
        theme.headerSurfaceClass,
      )}
    >
      <span className={cn("block h-1.5 w-14 rounded-full", theme.headerAccentClass)} />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-800">{title}</h3>
        <Badge
          variant="outline"
          className={cn("h-6 rounded-full px-2 text-[11px] font-semibold", theme.countBadgeClass)}
        >
          {laneCountLabel(count)}
        </Badge>
      </div>
    </header>
  );
}

function LaneEmptyState({ id }: { id: KanbanColumnId }): ReactElement {
  const theme = laneTheme(id);
  return (
    <div
      className={cn(
        "flex min-h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 text-center",
        theme.emptyStateClass,
      )}
    >
      <Inbox className="size-4 opacity-70" />
      <p className="text-xs font-medium">No tasks in this lane.</p>
    </div>
  );
}

export function KanbanColumn({
  column,
  runStateByTaskId,
  onOpenDetails,
  onDelegate,
  onPlan,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
}: KanbanColumnProps): ReactElement {
  const theme = laneTheme(column.id);

  return (
    <section
      className={cn(
        "flex h-full min-h-[420px] w-[328px] min-w-[328px] flex-col rounded-2xl border shadow-sm",
        theme.boardSurfaceClass,
      )}
    >
      <LaneHeader id={column.id} title={column.title} count={column.tasks.length} />
      <div className="flex-1 space-y-3 p-3">
        {column.tasks.length === 0 ? <LaneEmptyState id={column.id} /> : null}

        {column.tasks.map((task) => (
          <KanbanTaskCard
            key={task.id}
            task={task}
            runState={runStateByTaskId.get(task.id)}
            onOpenDetails={onOpenDetails}
            onDelegate={onDelegate}
            onPlan={onPlan}
            onBuild={onBuild}
            {...(onHumanApprove ? { onHumanApprove } : {})}
            {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
          />
        ))}
      </div>
    </section>
  );
}
