import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTaskCleanupImpact } from "@/components/features/task-details/use-task-cleanup-impact";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { KanbanPageModels } from "./kanban-page-model-types";
import { isActiveSessionUsingImplementationWorktree } from "./task-reset-session-guard";

type ResetImplementationModalModel = KanbanPageModels["resetImplementationModal"];
type ResetImplementationOptions = {
  closeDetailsAfterReset?: boolean;
};

type UseTaskResetFlowArgs = {
  tasks: TaskCard[];
  sessions: AgentSessionSummary[];
  taskWorktreeBasePath: string | null;
  resetTaskImplementation: (taskId: string) => Promise<void>;
  closeTaskDetails: () => void;
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
  sessions,
  taskWorktreeBasePath,
  resetTaskImplementation,
  closeTaskDetails,
}: UseTaskResetFlowArgs): {
  resetImplementationModal: ResetImplementationModalModel;
  openResetImplementation: (taskId: string, options?: ResetImplementationOptions) => boolean;
} {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [closeDetailsAfterReset, setCloseDetailsAfterReset] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const task = useMemo(
    () => (taskId ? (tasks.find((entry) => entry.id === taskId) ?? null) : null),
    [taskId, tasks],
  );
  const open = task !== null;
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

      const hasActiveSession = sessions.some(
        (session) =>
          session.taskId === nextTaskId &&
          isActiveSessionUsingImplementationWorktree(session, taskWorktreeBasePath),
      );
      if (hasActiveSession) {
        toast.error("Stop active work first", {
          description: `A task session is still active for ${nextTaskId}. Stop the active session before resetting the implementation.`,
        });
        return false;
      }

      setModalError(null);
      setTaskId(nextTaskId);
      setCloseDetailsAfterReset(options?.closeDetailsAfterReset ?? false);
      return true;
    },
    [sessions, taskWorktreeBasePath, tasks],
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
          closeTaskDetails();
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
    };
  }

  return {
    resetImplementationModal: {
      open,
      taskId: task.id,
      taskTitle: task.title,
      targetStatusLabel: deriveRollbackLabel(task),
      isSubmitting,
      isLoadingImpact,
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
  };
}
