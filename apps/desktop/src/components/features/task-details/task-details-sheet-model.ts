import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import { toDisplayTaskLabels } from "@/lib/task-labels";

type TaskWorkflowCallbacks = {
  onPlan: ((taskId: string, action: "set_spec" | "set_plan") => void) | undefined;
  onQaStart: ((taskId: string) => void) | undefined;
  onQaOpen: ((taskId: string) => void) | undefined;
  onBuild: ((taskId: string) => void) | undefined;
  onOpenSession?:
    | ((
        taskId: string,
        role: AgentRole,
        options?: { sessionId?: string | null; scenario?: AgentScenario | null },
      ) => void)
    | undefined;
  onDelegate: ((taskId: string) => void) | undefined;
  onDefer: ((taskId: string) => void) | undefined;
  onResumeDeferred: ((taskId: string) => void) | undefined;
  onHumanApprove: ((taskId: string) => void) | undefined;
  onHumanRequestChanges: ((taskId: string) => void) | undefined;
  onResetImplementation:
    | ((taskId: string, options?: { closeDetailsAfterReset?: boolean }) => void)
    | undefined;
};

type TaskWorkflowActionContext = {
  resolveSessionOptions?:
    | ((
        role: AgentRole,
      ) => { sessionId?: string | null; scenario?: AgentScenario | null } | undefined)
    | undefined;
};

export const toTaskLabels = toDisplayTaskLabels;

export const toSubtasks = (task: TaskCard | null, taskById: Map<string, TaskCard>): TaskCard[] => {
  if (!task) {
    return [];
  }

  return task.subtaskIds
    .map((subtaskId) => taskById.get(subtaskId))
    .filter((entry): entry is TaskCard => Boolean(entry));
};

export const collectDeleteImpactTaskIds = (
  task: TaskCard | null,
  taskById: Map<string, TaskCard>,
): string[] => {
  if (!task) {
    return [];
  }

  const collectedIds: string[] = [];
  const pendingIds = [task.id];
  const seenIds = new Set<string>();

  while (pendingIds.length > 0) {
    const currentId = pendingIds.shift();
    if (!currentId || seenIds.has(currentId)) {
      continue;
    }

    seenIds.add(currentId);
    collectedIds.push(currentId);

    const currentTask = taskById.get(currentId);
    if (!currentTask) {
      continue;
    }

    for (const subtaskId of currentTask.subtaskIds) {
      if (!seenIds.has(subtaskId)) {
        pendingIds.push(subtaskId);
      }
    }
  }

  return collectedIds;
};

export const collectResetImpactTaskIds = (task: TaskCard | null): string[] => {
  if (!task) {
    return [];
  }

  return [task.id];
};

export const runTaskWorkflowAction = (
  action: TaskWorkflowAction,
  taskId: string | null,
  callbacks: TaskWorkflowCallbacks,
  context?: TaskWorkflowActionContext,
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
    case "qa_start":
      callbacks.onQaStart?.(taskId);
      return;
    case "open_spec":
      callbacks.onOpenSession?.(taskId, "spec", context?.resolveSessionOptions?.("spec"));
      return;
    case "open_planner":
      callbacks.onOpenSession?.(taskId, "planner", context?.resolveSessionOptions?.("planner"));
      return;
    case "open_qa":
      if (callbacks.onOpenSession) {
        callbacks.onOpenSession(taskId, "qa", context?.resolveSessionOptions?.("qa"));
      } else {
        callbacks.onQaOpen?.(taskId);
      }
      return;
    case "open_builder":
      if (callbacks.onOpenSession) {
        callbacks.onOpenSession(taskId, "build", context?.resolveSessionOptions?.("build"));
      } else {
        callbacks.onBuild?.(taskId);
      }
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
    case "reset_implementation":
      callbacks.onResetImplementation?.(taskId, { closeDetailsAfterReset: true });
      return;
    default:
      return;
  }
};

export const shouldLoadDocumentSection = (hasDocument: boolean | undefined): boolean =>
  Boolean(hasDocument);
