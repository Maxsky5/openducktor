import type { TaskCard } from "@openducktor/contracts";
import { GitBranch } from "lucide-react";
import { memo, type ReactElement } from "react";
import { IssueTypeBadge, PriorityBadge } from "@/components/features/kanban/kanban-task-badges";
import { Badge } from "@/components/ui/badge";
import { statusBadgeVariant, statusLabel } from "@/lib/task-display";

type TaskDetailsSubtasksProps = {
  subtasks: TaskCard[];
};

export const TaskDetailsSubtasks = memo(
  function TaskDetailsSubtasks({ subtasks }: TaskDetailsSubtasksProps): ReactElement {
    return (
      <section className="space-y-3 rounded-xl border border-border/90 bg-card p-4 shadow-sm">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <GitBranch className="size-3.5" />
          Subtasks
        </h4>
        {subtasks.length > 0 ? (
          <ul className="space-y-2">
            {subtasks.map((subtask) => (
              <li
                key={subtask.id}
                className="space-y-2 rounded-lg border border-border bg-muted p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{subtask.title}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {subtask.id}
                    </p>
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
          <p className="rounded-lg border border-dashed border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            No subtasks yet.
          </p>
        )}
      </section>
    );
  },
  (previous, next) => {
    if (previous.subtasks === next.subtasks) {
      return true;
    }
    if (previous.subtasks.length !== next.subtasks.length) {
      return false;
    }

    for (let index = 0; index < previous.subtasks.length; index += 1) {
      const previousSubtask = previous.subtasks[index];
      const nextSubtask = next.subtasks[index];
      if (!previousSubtask || !nextSubtask) {
        return false;
      }
      if (
        previousSubtask.id !== nextSubtask.id ||
        previousSubtask.title !== nextSubtask.title ||
        previousSubtask.status !== nextSubtask.status ||
        previousSubtask.issueType !== nextSubtask.issueType ||
        previousSubtask.priority !== nextSubtask.priority
      ) {
        return false;
      }
    }

    return true;
  },
);
