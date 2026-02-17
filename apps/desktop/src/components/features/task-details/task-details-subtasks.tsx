import { IssueTypeBadge, PriorityBadge } from "@/components/features/kanban/kanban-task-badges";
import { Badge } from "@/components/ui/badge";
import { statusBadgeVariant, statusLabel } from "@/lib/task-display";
import type { TaskCard } from "@openblueprint/contracts";
import { GitBranch } from "lucide-react";
import type { ReactElement } from "react";

type TaskDetailsSubtasksProps = {
  subtasks: TaskCard[];
};

export function TaskDetailsSubtasks({ subtasks }: TaskDetailsSubtasksProps): ReactElement {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <GitBranch className="size-3.5" />
        Subtasks
      </h4>
      {subtasks.length > 0 ? (
        <ul className="space-y-2">
          {subtasks.map((subtask) => (
            <li
              key={subtask.id}
              className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{subtask.title}</p>
                  <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{subtask.id}</p>
                </div>
                <Badge variant={statusBadgeVariant(subtask.status)}>
                  {statusLabel(subtask.status)}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <IssueTypeBadge issueType={subtask.issueType} />
                <PriorityBadge priority={subtask.priority} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No subtasks yet.
        </p>
      )}
    </section>
  );
}
