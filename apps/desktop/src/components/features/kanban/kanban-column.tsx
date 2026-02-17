import { KanbanTaskCard } from "@/components/features/kanban/kanban-task-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TaskCard } from "@openblueprint/contracts";
import type { ReactElement } from "react";

type KanbanColumnData = {
  id: string;
  title: string;
  tasks: TaskCard[];
};

type KanbanColumnProps = {
  column: KanbanColumnData;
  runStateByTaskId: Map<string, string>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string) => void;
  onBuild: (taskId: string) => void;
};

export function KanbanColumn({
  column,
  runStateByTaskId,
  onOpenDetails,
  onDelegate,
  onPlan,
  onBuild,
}: KanbanColumnProps): ReactElement {
  return (
    <Card className="min-h-[320px] border-slate-200/90">
      <CardHeader className="rounded-t-xl border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <CardTitle className="text-sm uppercase tracking-wide text-slate-700">
          {column.title}
        </CardTitle>
        <CardDescription>{column.tasks.length} task(s)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {column.tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500">
            No tasks in this lane.
          </div>
        ) : null}

        {column.tasks.map((task) => (
          <KanbanTaskCard
            key={task.id}
            task={task}
            runState={runStateByTaskId.get(task.id)}
            onOpenDetails={onOpenDetails}
            onDelegate={onDelegate}
            onPlan={onPlan}
            onBuild={onBuild}
          />
        ))}
      </CardContent>
    </Card>
  );
}
