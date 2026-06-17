import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTaskDeleteImpact } from "@/components/features/task-details/use-task-delete-impact";
import { isAgentSessionActivityActive } from "@/lib/agent-session-activity-state";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { KanbanPageModels } from "./kanban-page-model-types";

type ResetImplementationModalModel = KanbanPageModels["resetImplementationModal"];
type ResetImplementationOptions = {
  closeDetailsAfterReset?: boolean;
};

type UseTaskResetFlowArgs = {
  tasks: TaskCard[];
  sessions: AgentSessionSummary[];
  refreshTaskSessions: (taskId: string) => Promise<void>;
  resetTaskImplementation: (taskId: string) => Promise<void>;
  closeTaskDetails: () => void;
};

const isActiveImplementationSession = (session: AgentSessionSummary): boolean => {
  if (session.role !== "build" && session.role !== "qa") {
    return false;
  }

  return isAgentSessionActivityActive(session.activityState);
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
  refreshTaskSessions,
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
  const { hasManagedSessionCleanup, managedWorktreeCount, impactError, isLoadingImpact } =
    useTaskDeleteImpact(taskId ? [taskId] : [], open);

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
        (session) => session.taskId === nextTaskId && isActiveImplementationSession(session),
      );
      if (hasActiveSession) {
        toast.error("Stop active work first", {
          description: `Builder or QA is still active for ${nextTaskId}. Stop the active session before resetting the implementation.`,
        });
        return false;
      }

      setModalError(null);
      setTaskId(nextTaskId);
      setCloseDetailsAfterReset(options?.closeDetailsAfterReset ?? false);
      return true;
    },
    [sessions, tasks],
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
        await refreshTaskSessions(task.id);
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
  }, [
    closeTaskDetails,
    closeDetailsAfterReset,
    isSubmitting,
    refreshTaskSessions,
    resetTaskImplementation,
    task,
  ]);

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
      hasManagedSessionCleanup,
      managedWorktreeCount,
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
