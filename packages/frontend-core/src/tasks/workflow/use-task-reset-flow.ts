import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { isOutcomeUnknown } from "../../lib/command-outcome";
import { errorMessage } from "../../lib/errors";
import { useSingleFlight } from "../../lib/use-single-flight";
import { useTaskStopImpact } from "../../queries/use-task-stop-impact";
import { useTaskCleanupImpact } from "../details/use-task-cleanup-impact";

export type TaskResetImplementationModalModel = {
  open: boolean;
  taskId: string;
  taskTitle: string;
  targetStatusLabel: string;
  isSubmitting: boolean;
  activeSessionCount: number | null;
  activeSessionCountError: string | null;
  isLoadingImpact: boolean;
  hasCanonicalWorktree: boolean;
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  legacyWorktreeCount: number;
  terminalCount: number;
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
};

type ResetFlowWorkspaceIdentity = {
  workspaceId: string;
  repoPath: string;
};

type ResetFlowRequest = ResetFlowWorkspaceIdentity & {
  taskId: string;
  closeDetailsAfterReset: boolean;
};

type UseTaskResetFlowArgs = {
  tasks: TaskCard[];
  workspaceIdentity: ResetFlowWorkspaceIdentity | null;
  resetTaskImplementation: (taskId: string) => Promise<void>;
  closeTaskDetails: (taskId: string) => void;
};

const deriveRollbackLabel = (task: TaskCard): string => {
  if (task.artifactSummary.plan.has) {
    return "Ready for Dev";
  }
  if (task.artifactSummary.spec.has) {
    return "Spec Ready";
  }
  return "Backlog";
};

export function useTaskResetFlow({
  tasks,
  workspaceIdentity,
  resetTaskImplementation,
  closeTaskDetails,
}: UseTaskResetFlowArgs) {
  const [request, setRequest] = useState<ResetFlowRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One reset at a time, so a double tap resets the task once.
  const resetFlight = useSingleFlight();
  const { feedback } = useClientConnection();
  const [modalError, setModalError] = useState<{
    message: string;
    outcomeUnknown: boolean;
  } | null>(null);

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
  const {
    stoppableSessionCount: activeSessionCount,
    isLoading: isLoadingStopImpact,
    error: stopImpactError,
  } = useTaskStopImpact({
    taskIds: openTaskId ? [openTaskId] : [],
    operation: "reset_implementation",
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

  const closeModal = useCallback((): void => {
    if (isSubmitting) {
      return;
    }
    setRequest(null);
    setModalError(null);
  }, [isSubmitting]);

  const openResetImplementation = useCallback(
    (nextTaskId: string, options?: ResetImplementationOptions): boolean => {
      const nextTask = tasks.find((entry) => entry.id === nextTaskId);
      if (!nextTask || !workspaceIdentity) {
        feedback.show("error", "Unable to reset implementation", {
          description: `Task ${nextTaskId} was not found. Refresh tasks and try again.`,
        });
        return false;
      }

      setModalError(null);
      setRequest({
        taskId: nextTaskId,
        workspaceId: workspaceIdentity.workspaceId,
        repoPath: workspaceIdentity.repoPath,
        closeDetailsAfterReset: options?.closeDetailsAfterReset ?? false,
      });
      return true;
    },
    [feedback, tasks, workspaceIdentity],
  );

  const confirmReset = useCallback((): void => {
    if (!task || !request || !isWorkspaceCurrent) {
      return;
    }

    void resetFlight.start(async () => {
      setIsSubmitting(true);
      setModalError(null);
      try {
        await resetTaskImplementation(task.id);
        setRequest(null);
        if (request.closeDetailsAfterReset) {
          closeTaskDetails(task.id);
        }
      } catch (error: unknown) {
        setModalError({ message: errorMessage(error), outcomeUnknown: isOutcomeUnknown(error) });
      } finally {
        setIsSubmitting(false);
      }
    });
  }, [closeTaskDetails, isWorkspaceCurrent, request, resetFlight, resetTaskImplementation, task]);

  if (!task) {
    return {
      resetImplementationModal: null,
      openResetImplementation,
    } satisfies {
      resetImplementationModal: ResetImplementationModalModel | null;
      openResetImplementation: (taskId: string, options?: ResetImplementationOptions) => boolean;
    };
  }

  return {
    resetImplementationModal: {
      open,
      taskId: task.id,
      taskTitle: task.title,
      targetStatusLabel: deriveRollbackLabel(task),
      isSubmitting,
      activeSessionCount,
      activeSessionCountError: stopImpactError,
      isLoadingImpact: isLoadingImpact || isLoadingStopImpact,
      hasCanonicalWorktree,
      hasManagedSessionCleanup,
      managedWorktreeCount,
      legacyWorktreeCount,
      terminalCount,
      impactError,
      errorMessage: modalError?.message ?? null,
      errorOutcomeUnknown: modalError?.outcomeUnknown ?? false,
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
    openResetImplementation: (taskId: string, options?: ResetImplementationOptions) => boolean;
  };
}
