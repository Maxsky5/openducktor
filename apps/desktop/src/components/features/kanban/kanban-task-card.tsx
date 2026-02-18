import {
  IssueTypeBadge,
  PriorityBadge,
  RunStateBadge,
} from "@/components/features/kanban/kanban-task-badges";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import { Badge } from "@/components/ui/badge";
import type { RunSummary, TaskCard } from "@openblueprint/contracts";
import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";

type KanbanTaskCardProps = {
  task: TaskCard;
  runState?: RunSummary["state"] | undefined;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
};

function TaskMeta({
  task,
  runState,
}: {
  task: TaskCard;
  runState: RunSummary["state"] | undefined;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <IssueTypeBadge issueType={task.issueType} />
      <PriorityBadge priority={task.priority} />
      {task.subtaskIds.length > 0 ? (
        <Badge
          variant="secondary"
          className="h-6 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700"
        >
          {task.subtaskIds.length} subtasks
        </Badge>
      ) : null}
      {runState ? <RunStateBadge runState={runState} /> : null}
    </div>
  );
}

function TaskActions({
  task,
  onPlan,
  onBuild,
  onDelegate,
  onHumanApprove,
  onHumanRequestChanges,
}: {
  task: TaskCard;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
}): ReactElement {
  const runAction = (action: TaskWorkflowAction): void => {
    switch (action) {
      case "set_spec":
      case "set_plan":
        onPlan(task.id, action);
        return;
      case "open_builder":
        onBuild(task.id);
        return;
      case "build_start":
        onDelegate(task.id);
        return;
      case "human_approve":
        onHumanApprove?.(task.id);
        return;
      case "human_request_changes":
        onHumanRequestChanges?.(task.id);
        return;
      default:
        return;
    }
  };

  return (
    <div className="mt-3 cursor-default border-t border-slate-100 pt-2.5">
      <TaskWorkflowActionGroup
        task={task}
        includeActions={[
          "set_spec",
          "set_plan",
          "build_start",
          "open_builder",
          "human_approve",
          "human_request_changes",
        ]}
        onAction={runAction}
        size="sm"
        expandPrimary
        compactMenuTrigger
        primaryClassName="h-9 rounded-lg font-semibold shadow-sm"
      />
    </div>
  );
}

export function KanbanTaskCard({
  task,
  runState,
  onOpenDetails,
  onDelegate,
  onPlan,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
}: KanbanTaskCardProps): ReactElement {
  return (
    <article className="group flex min-w-0 cursor-pointer flex-col space-y-2.5 overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 p-3.5 shadow-sm transition duration-150 hover:border-sky-200 hover:shadow-md">
      <button
        type="button"
        className="flex w-full min-w-0 cursor-pointer items-start justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
        onClick={() => onOpenDetails(task.id)}
      >
        <div className="min-w-0 space-y-1">
          <p className="break-words text-sm font-semibold leading-tight text-slate-900 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
            {task.title}
          </p>
          <p className="truncate font-mono text-[11px] text-slate-500">{task.id}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] text-slate-400 transition group-hover:border-slate-200 group-hover:bg-slate-50 group-hover:text-slate-600">
          <ExternalLink className="size-3" />
          Open
        </span>
      </button>

      <TaskMeta task={task} runState={runState} />

      <TaskActions
        task={task}
        onPlan={onPlan}
        onBuild={onBuild}
        onDelegate={onDelegate}
        {...(onHumanApprove ? { onHumanApprove } : {})}
        {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
      />
    </article>
  );
}
