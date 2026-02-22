import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import type { TaskCard } from "@openducktor/contracts";

type TaskWorkflowCallbacks = {
  onPlan: ((taskId: string, action: "set_spec" | "set_plan") => void) | undefined;
  onBuild: ((taskId: string) => void) | undefined;
  onDelegate: ((taskId: string) => void) | undefined;
  onDefer: ((taskId: string) => void) | undefined;
  onResumeDeferred: ((taskId: string) => void) | undefined;
  onHumanApprove: ((taskId: string) => void) | undefined;
  onHumanRequestChanges: ((taskId: string) => void) | undefined;
};

export const toTaskLabels = (labels: string[] | undefined): string[] =>
  (labels ?? []).filter((label) => !label.startsWith("phase:"));

export const toSubtasks = (task: TaskCard | null, taskById: Map<string, TaskCard>): TaskCard[] => {
  if (!task) {
    return [];
  }

  return task.subtaskIds
    .map((subtaskId) => taskById.get(subtaskId))
    .filter((entry): entry is TaskCard => Boolean(entry));
};

export const runTaskWorkflowAction = (
  action: TaskWorkflowAction,
  taskId: string | null,
  callbacks: TaskWorkflowCallbacks,
): void => {
  if (!taskId) {
    return;
  }

  switch (action) {
    case "set_spec":
      callbacks.onPlan?.(taskId, action);
      return;
    case "set_plan":
      callbacks.onPlan?.(taskId, action);
      return;
    case "open_builder":
      callbacks.onBuild?.(taskId);
      return;
    case "build_start":
      callbacks.onDelegate?.(taskId);
      return;
    case "defer_issue":
      callbacks.onDefer?.(taskId);
      return;
    case "resume_deferred":
      callbacks.onResumeDeferred?.(taskId);
      return;
    case "human_approve":
      callbacks.onHumanApprove?.(taskId);
      return;
    case "human_request_changes":
      callbacks.onHumanRequestChanges?.(taskId);
      return;
    default:
      return;
  }
};

export const shouldLoadDocumentSection = (hasDocument: boolean | undefined): boolean =>
  Boolean(hasDocument);
