import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import { toDisplayTaskLabels } from "@/lib/task-labels";

type TaskWorkflowCallbacks = {
  onPlan: ((taskId: string, action: "set_spec" | "set_plan") => void) | undefined;
  onQaStart: ((taskId: string) => void) | undefined;
  onQaOpen: ((taskId: string) => void) | undefined;
  onBuild: ((taskId: string) => void) | undefined;
  onOpenSession?:
    | ((taskId: string, role: AgentRole, options?: { externalSessionId?: string | null }) => void)
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
    | ((role: AgentRole) => { externalSessionId?: string | null } | undefined)
    | undefined;
};

type OpenSessionWorkflowAction = Extract<
  TaskWorkflowAction,
  "open_spec" | "open_planner" | "open_qa" | "open_builder"
>;

type RoleSessionActionConfig = {
  role: AgentRole;
  fallback?: (callbacks: TaskWorkflowCallbacks, taskId: string) => void;
};

const roleSessionActions: Record<OpenSessionWorkflowAction, RoleSessionActionConfig> = {
  open_spec: { role: "spec" },
  open_planner: { role: "planner" },
  open_qa: {
    role: "qa",
    fallback: (callbacks, taskId) => callbacks.onQaOpen?.(taskId),
  },
  open_builder: {
    role: "build",
    fallback: (callbacks, taskId) => callbacks.onBuild?.(taskId),
  },
} satisfies Record<OpenSessionWorkflowAction, RoleSessionActionConfig>;

const openRoleSession = (
  action: OpenSessionWorkflowAction,
  taskId: string,
  callbacks: TaskWorkflowCallbacks,
  context: TaskWorkflowActionContext | undefined,
): void => {
  const actionConfig = roleSessionActions[action];

  if (callbacks.onOpenSession) {
    callbacks.onOpenSession(
      taskId,
      actionConfig.role,
      context?.resolveSessionOptions?.(actionConfig.role),
    );
    return;
  }

  actionConfig.fallback?.(callbacks, taskId);
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
    case "set_plan":
      callbacks.onPlan?.(taskId, action);
      return;
    case "qa_start":
      callbacks.onQaStart?.(taskId);
      return;
    case "open_spec":
    case "open_planner":
    case "open_qa":
    case "open_builder":
      openRoleSession(action, taskId, callbacks, context);
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
