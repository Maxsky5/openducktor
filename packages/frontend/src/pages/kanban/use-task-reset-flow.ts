import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTaskCleanupImpact } from "@/components/features/task-details/use-task-cleanup-impact";
import { errorMessage } from "@/lib/errors";
import { useTaskStopImpact } from "@/state/queries/use-task-stop-impact";
import type { TaskResetImplementationModalModel } from "./kanban-page-model-types";

type ResetImplementationModalModel = TaskResetImplementationModalModel;
type ResetImplementationOptions = {
  closeDetailsAfterReset?: boolean;
};

type ResetFlowWorkspaceIdentity = {
  workspaceId: string;
  repoPath: string;
};

type UseTaskResetFlowArgs = {
  tasks: TaskCard[];
  workspaceIdentity: ResetFlowWorkspaceIdentity | null;
  resetTaskImplementation: (taskId: string) => Promise<void>;
  closeTaskDetails: (taskId: string) => void;
};

const deriveRollbackLabel = (task: TaskCard): string => {
  if (task.documentSummary.plan.has) {
    return "Ready for Dev";
  }
  if (task.documentSummary.spec.has) {
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
  const [taskId, setTaskId] = useState<string | null>(null);
  const [closeDetailsAfterReset, setCloseDetailsAfterReset] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const workspaceIdentityRef = useRef(workspaceIdentity);

  useEffect(() => {
    const previousIdentity = workspaceIdentityRef.current;
    if (
      previousIdentity?.workspaceId === workspaceIdentity?.workspaceId &&
      previousIdentity?.repoPath === workspaceIdentity?.repoPath
    ) {
      return;
    }
    workspaceIdentityRef.current = workspaceIdentity;
    setTaskId(null);
    setCloseDetailsAfterReset(false);
    setModalError(null);
  }, [workspaceIdentity]);

  const task = useMemo(
    () => (taskId ? (tasks.find((entry) => entry.id === taskId) ?? null) : null),
    [taskId, tasks],
  );
  const open = task !== null;
  const {
    stoppableSessionCount: activeSessionCount,
    isLoading: isLoadingStopImpact,
    error: stopImpactError,
  } = useTaskStopImpact({
    taskIds: taskId ? [taskId] : [],
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
  } = useTaskCleanupImpact(taskId ? [taskId] : [], open);

  const closeModal = useCallback((): void => {
    if (isSubmitting) {
      return;
    }
    setTaskId(null);
    setCloseDetailsAfterReset(false);
    setModalError(null);
  }, [isSubmitting]);

  const openResetImplementation = useCallback(
    (nextTaskId: string, options?: ResetImplementationOptions): boolean => {
      const nextTask = tasks.find((entry) => entry.id === nextTaskId);
      if (!nextTask) {
        toast.error("Unable to reset implementation", {
          description: `Task ${nextTaskId} was not found. Refresh tasks and try again.`,
        });
        return false;
      }

      setModalError(null);
      setTaskId(nextTaskId);
      setCloseDetailsAfterReset(options?.closeDetailsAfterReset ?? false);
      return true;
    },
    [tasks],
  );

  const confirmReset = useCallback((): void => {
    if (!task || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setModalError(null);

    void (async () => {
      try {
        await resetTaskImplementation(task.id);
        setTaskId(null);
        setCloseDetailsAfterReset(false);
        if (closeDetailsAfterReset) {
          closeTaskDetails(task.id);
        }
      } catch (error: unknown) {
        setModalError(errorMessage(error));
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [closeTaskDetails, closeDetailsAfterReset, isSubmitting, resetTaskImplementation, task]);

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
      errorMessage: modalError,
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
