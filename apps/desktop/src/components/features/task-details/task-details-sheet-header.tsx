import type { TaskCard } from "@openducktor/contracts";
import { Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import { IssueTypeBadge, PriorityBadge } from "@/components/features/kanban/kanban-task-badges";
import { Badge } from "@/components/ui/badge";
import { statusBadgeVariant, statusLabel } from "@/lib/task-display";

type TaskDetailsSheetHeaderProps = {
  task: TaskCard;
  subtasksCount: number;
  taskLabels: string[];
};

export function TaskDetailsSheetHeader({
  task,
  subtasksCount,
  taskLabels,
}: TaskDetailsSheetHeaderProps): ReactElement {
  const isEpic = task.issueType === "epic";
  const aiReviewBadge = task.aiReviewEnabled ? (
    <Badge
      variant="outline"
      className="border-success-border bg-success-surface text-success-muted"
    >
      AI QA required
    </Badge>
  ) : (
    <Badge variant="outline" className="border-input bg-muted text-foreground">
      AI QA optional
    </Badge>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Sparkles className="size-5 shrink-0 text-primary" />
            <span className="truncate">{task.title}</span>
          </h2>
          <p className="truncate font-mono text-xs text-muted-foreground">{task.id}</p>
        </div>
        <Badge variant={statusBadgeVariant(task.status)}>{statusLabel(task.status)}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <IssueTypeBadge issueType={task.issueType} />
        <PriorityBadge priority={task.priority} />
        {aiReviewBadge}
        {isEpic ? (
          <Badge
            variant="outline"
            className="border-pending-border bg-pending-surface text-pending-muted"
          >
            {subtasksCount} subtask{subtasksCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>

      {taskLabels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {taskLabels.map((label) => (
            <Badge
              key={label}
              variant="outline"
              className="h-6 rounded-full border-input bg-card px-2.5 text-[11px] font-medium text-foreground"
            >
              {label}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
