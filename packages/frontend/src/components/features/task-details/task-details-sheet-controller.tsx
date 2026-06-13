import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { type ReactElement, type Ref, useImperativeHandle, useMemo, useState } from "react";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import { TaskDetailsSheet } from "./task-details-sheet";
import type { TaskDetailsSheetProps } from "./task-details-sheet-types";

export type TaskDetailsSheetControllerHandle = {
  openTask: (taskId: string) => void;
  close: () => void;
};

type TaskDetailsSheetControllerProps = Omit<
  TaskDetailsSheetProps,
  "task" | "open" | "onOpenChange"
> & {
  allTasks: TaskCard[];
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  historicalSessionsByTaskId: Map<string, AgentSessionRecord[]>;
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  onOpenSession?: (
    taskId: string,
    role: AgentRole,
    options?: { externalSessionId?: string | null },
  ) => void;
  ref?: Ref<TaskDetailsSheetControllerHandle>;
};

export function TaskDetailsSheetController({
  activeWorkspace = null,
  allTasks,
  taskSessionsByTaskId,
  historicalSessionsByTaskId,
  activeTaskSessionContextByTaskId,
  workflowActionsEnabled,
  onOpenSession,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
  onDelegate,
  onEdit,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
  onResetTask,
  onDetectPullRequest,
  onUnlinkPullRequest,
  detectingPullRequestTaskId,
  unlinkingPullRequestTaskId,
  onDelete,
  ref,
}: TaskDetailsSheetControllerProps): ReactElement {
  const [taskId, setTaskId] = useState<string | null>(null);

  const task = useMemo(
    () => (taskId ? (allTasks.find((entry) => entry.id === taskId) ?? null) : null),
    [allTasks, taskId],
  );
  // Reset during render so React discards this stale task pass instead of committing it.
  if (taskId && !task) {
    setTaskId(null);
  }
  const open = task !== null;

  // The handle only captures React's stable state dispatch.
  useImperativeHandle(
    ref,
    () => ({
      openTask: (nextTaskId: string) => {
        setTaskId(nextTaskId);
      },
      close: () => {
        setTaskId(null);
      },
    }),
    [],
  );

  const activeTaskId = task ? taskId : null;
  const selectedTaskSessions = activeTaskId ? (taskSessionsByTaskId.get(activeTaskId) ?? []) : [];
  const selectedHistoricalSessions = activeTaskId
    ? (historicalSessionsByTaskId.get(activeTaskId) ?? [])
    : [];
  const selectedActiveSessionContext = activeTaskId
    ? activeTaskSessionContextByTaskId.get(activeTaskId)
    : undefined;

  return (
    <TaskDetailsSheet
      activeWorkspace={activeWorkspace}
      task={task}
      allTasks={allTasks}
      taskSessions={selectedTaskSessions}
      historicalSessions={selectedHistoricalSessions}
      hasActiveSession={Boolean(selectedActiveSessionContext)}
      {...(selectedActiveSessionContext?.role
        ? { activeSessionRole: selectedActiveSessionContext.role }
        : {})}
      {...(selectedActiveSessionContext?.presentationState
        ? { activeSessionPresentationState: selectedActiveSessionContext.presentationState }
        : {})}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setTaskId(null);
        }
      }}
      {...(workflowActionsEnabled !== undefined ? { workflowActionsEnabled } : {})}
      {...(onPlan ? { onPlan } : {})}
      {...(onQaStart ? { onQaStart } : {})}
      {...(onQaOpen ? { onQaOpen } : {})}
      {...(onBuild ? { onBuild } : {})}
      {...(onOpenSession ? { onOpenSession } : {})}
      {...(onDelegate ? { onDelegate } : {})}
      {...(onEdit ? { onEdit } : {})}
      {...(onHumanApprove ? { onHumanApprove } : {})}
      {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
      {...(onResetImplementation ? { onResetImplementation } : {})}
      {...(onResetTask ? { onResetTask } : {})}
      {...(onDetectPullRequest ? { onDetectPullRequest } : {})}
      {...(onUnlinkPullRequest ? { onUnlinkPullRequest } : {})}
      {...(detectingPullRequestTaskId !== undefined ? { detectingPullRequestTaskId } : {})}
      {...(unlinkingPullRequestTaskId !== undefined ? { unlinkingPullRequestTaskId } : {})}
      {...(onDelete ? { onDelete } : {})}
    />
  );
}
