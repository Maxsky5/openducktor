import { useSessionStartContext } from "../../sessions/start/use-session-start-context";
import type { TaskCard as WireTaskCard } from "@openducktor/contracts";
import type { OnTaskCommitted } from "./task-workflow-continuation";
import {
  type ResolvedTaskCard as TaskCard,
  taskWaitsForMergePublication,
} from "@openducktor/workflows";
import { useCallback, useMemo, useRef, useState } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { useTaskStopImpact } from "../../queries/use-task-stop-impact";
import {
  type TaskWorktreeOwnersRead,
  useTaskWorktreeOwners,
} from "../../queries/use-task-worktree-owners";
import { useTaskCleanupImpact } from "../details/use-task-cleanup-impact";

export type TaskResetImplementationModalModel = {
  open: boolean;
  taskId: string;
  taskTitle: string;
  /** The label of the workflow action that resets the worktree, for example "Reset Implementation". */
  actionLabel: string;
  targetStatusLabel: string;
  /** The roles whose sessions the reset clears, by label. */
  worktreeRoleLabels: readonly string[];
  /** A local direct merge waits for its publication. The reset drops its record. */
  dropsLocalMerge: boolean;
  isSubmitting: boolean;
  activeSessionCount: number | null;
  activeSessionCountError: string | null;
  isLoadingImpact: boolean;
  hasCanonicalWorktree: boolean;
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  legacyWorktreeCount: number;
  terminalCount: number;
  /** The others that need a removed worktree. */
  worktreeOwners: TaskWorktreeOwnersRead;
  impactError: string | null;
  errorMessage: string | null;
  /** True when the connection lost the result of the reset. The host may have run it. */
  errorOutcomeUnknown: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

type ResetImplementationModalModel = TaskResetImplementationModalModel;
type ResetImplementationOptions = {
  closeDetailsAfterReset?: boolean;
  onCommitted?: OnTaskCommitted | undefined;
};

type ResetFlowWorkspaceIdentity = {
  workspaceId: string;
  repoPath: string;
};

/** The labels of the roles whose session history the reset event clears. */
const resetRoleLabels = (task: TaskCard, eventId: string | undefined): string[] => {
  const reset = eventId === undefined ? undefined : task.taskWorkflow.worktreeReset(eventId);
  return (reset?.clearsSessionsOf ?? []).map((role) => task.taskWorkflow.role(role).label);
};

type ResetFlowRequest = ResetFlowWorkspaceIdentity & {
  taskId: string;
  /** The workflow event whose `worktree.reset` effect resets the implementation. */
  eventId: string;
  closeDetailsAfterReset: boolean;
  onCommitted?: OnTaskCommitted | undefined;
};

type UseTaskResetFlowArgs = {
  tasks: TaskCard[];
  workspaceIdentity: ResetFlowWorkspaceIdentity | null;
  resetTaskImplementation: (taskId: string, eventId: string) => Promise<WireTaskCard>;
  closeTaskDetails: (taskId: string) => void;
};

/** A task that does not admit the event keeps its status, and the host rejects the request. */
/** The label of the event action of the reset, so the dialog uses the workflow's own name. */
const resetActionLabel = (task: TaskCard, eventId: string): string => {
  const action = task.taskWorkflow.definition.actions.find(
    (entry) => entry.kind === "event" && entry.eventId === eventId,
  );
  if (!action)
    throw new Error(`Task workflow has no action for event "${eventId}". Reload the task.`);
  return action.label;
};

const deriveRollbackLabel = (task: TaskCard, eventId: string): string => {
  const workflow = task.taskWorkflow;
  const decision = workflow.decide(eventId, task);
  const status = decision.kind === "transition" ? decision.to : task.status;
  const state = workflow.state(status);
  return state.title ?? state.label;
};

export function useTaskResetFlow({
  tasks,
  workspaceIdentity,
  resetTaskImplementation,
  closeTaskDetails,
}: UseTaskResetFlowArgs) {
  const [request, setRequest] = useState<ResetFlowRequest | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { feedback, backgroundOperations } = useClientConnection();
  const isCurrent = useSessionStartContext(
    workspaceIdentity ? JSON.stringify(workspaceIdentity) : null,
  );
  const submitted = useRef<ResetFlowRequest | null>(null);

  const isWorkspaceCurrent =
    request !== null &&
    request.workspaceId === workspaceIdentity?.workspaceId &&
    request.repoPath === workspaceIdentity?.repoPath;
  const task = useMemo(
    () =>
      isWorkspaceCurrent && request
        ? (tasks.find((entry) => entry.id === request.taskId) ?? null)
        : null,
    [isWorkspaceCurrent, request, tasks],
  );
  const open = task !== null;
  const openTaskId = task?.id ?? null;
  const preview = request
    ? { operation: "reset_implementation" as const, eventId: request.eventId }
    : null;
  const {
    stoppableSessionCount: activeSessionCount,
    isLoading: isLoadingStopImpact,
    error: stopImpactError,
  } = useTaskStopImpact({
    taskIds: openTaskId ? [openTaskId] : [],
    preview,
    enabled: open,
  });
  const worktreeOwners = useTaskWorktreeOwners({
    taskIds: openTaskId ? [openTaskId] : [],
    preview,
    enabled: open,
  });
  const {
    hasCanonicalWorktree,
    hasManagedSessionCleanup,
    managedWorktreeCount,
    legacyWorktreeCount,
    terminalCount,
    impactError,
    isLoadingImpact,
  } = useTaskCleanupImpact(openTaskId ? [openTaskId] : [], open);

  const closeModal = useCallback(() => {
    setRequest(null);
  }, []);

  const openResetImplementation = useCallback(
    (nextTaskId: string, eventId: string, options?: ResetImplementationOptions): boolean => {
      const nextTask = tasks.find((entry) => entry.id === nextTaskId);
      if (!nextTask || !workspaceIdentity) {
        feedback.show("error", "Unable to reset implementation", {
          description: `Task ${nextTaskId} was not found. Refresh tasks and try again.`,
        });
        return false;
      }

      const nextRequest: ResetFlowRequest = {
        taskId: nextTaskId,
        eventId,
        workspaceId: workspaceIdentity.workspaceId,
        repoPath: workspaceIdentity.repoPath,
        closeDetailsAfterReset: options?.closeDetailsAfterReset ?? false,
      };
      if (options?.onCommitted) nextRequest.onCommitted = options.onCommitted;
      setErrorMessage(null);
      setRequest(nextRequest);
      return true;
    },
    [feedback, tasks, workspaceIdentity],
  );

  const confirmReset = useCallback((): void => {
    if (!task || !request || submitted.current === request || !isWorkspaceCurrent) {
      return;
    }
    const refusal = backgroundOperations.admissionError(request, { kind: "task", taskId: task.id });
    if (refusal) {
      setErrorMessage(refusal);
      return;
    }

    submitted.current = request;
    const result = resetTaskImplementation(task.id, request.eventId);
    setRequest(null);
    void result
      .then(async (committed) => {
        await request.onCommitted?.(committed);
        if (request.closeDetailsAfterReset && isCurrent()) closeTaskDetails(task.id);
      })
      .catch(() => {
        // The background operation reports the command outcome.
      });
  }, [
    backgroundOperations,
    closeTaskDetails,
    isCurrent,
    isWorkspaceCurrent,
    request,
    resetTaskImplementation,
    task,
  ]);

  if (!task) {
    return {
      resetImplementationModal: null,
      openResetImplementation,
    } satisfies {
      resetImplementationModal: ResetImplementationModalModel | null;
      openResetImplementation: (
        taskId: string,
        eventId: string,
        options?: ResetImplementationOptions,
      ) => boolean;
    };
  }

  return {
    resetImplementationModal: {
      open,
      taskId: task.id,
      taskTitle: task.title,
      actionLabel: request ? resetActionLabel(task, request.eventId) : "",
      targetStatusLabel: request ? deriveRollbackLabel(task, request.eventId) : "",
      worktreeRoleLabels: resetRoleLabels(task, request?.eventId),
      dropsLocalMerge: taskWaitsForMergePublication(task),
      isSubmitting: false,
      activeSessionCount,
      activeSessionCountError: stopImpactError,
      isLoadingImpact: isLoadingImpact || isLoadingStopImpact || worktreeOwners.isLoading,
      hasCanonicalWorktree,
      hasManagedSessionCleanup,
      managedWorktreeCount,
      legacyWorktreeCount,
      terminalCount,
      worktreeOwners,
      impactError,
      errorMessage,
      errorOutcomeUnknown: false,
      onOpenChange: (nextOpen) => {
        if (!nextOpen) {
          closeModal();
        }
      },
      onCancel: closeModal,
      onConfirm: confirmReset,
    },
    openResetImplementation,
  } satisfies {
    resetImplementationModal: ResetImplementationModalModel | null;
    openResetImplementation: (
      taskId: string,
      eventId: string,
      options?: ResetImplementationOptions,
    ) => boolean;
  };
}
