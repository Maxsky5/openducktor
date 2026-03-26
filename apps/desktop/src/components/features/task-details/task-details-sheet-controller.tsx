import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import {
  forwardRef,
  type ReactElement,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
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
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  onOpenSession: (
    taskId: string,
    role: AgentRole,
    options?: { sessionId?: string | null; scenario?: AgentScenario | null },
  ) => void;
};

export const TaskDetailsSheetController = forwardRef<
  TaskDetailsSheetControllerHandle,
  TaskDetailsSheetControllerProps
>(function TaskDetailsSheetController(
  {
    activeRepo = null,
    allTasks,
    runs,
    taskSessionsByTaskId,
    activeTaskSessionContextByTaskId,
    workflowActionsEnabled,
    onOpenSession,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onDelegate,
    onEdit,
    onDefer,
    onResumeDeferred,
    onHumanApprove,
    onHumanRequestChanges,
    onResetImplementation,
    onDetectPullRequest,
    onUnlinkPullRequest,
    detectingPullRequestTaskId,
    unlinkingPullRequestTaskId,
    onDelete,
  },
  ref,
): ReactElement {
  const [taskId, setTaskId] = useState<string | null>(null);

  const task = useMemo(
    () => (taskId ? (allTasks.find((entry) => entry.id === taskId) ?? null) : null),
    [allTasks, taskId],
  );
  const open = task !== null;

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

  useEffect(() => {
    if (taskId && !task) {
      setTaskId(null);
    }
  }, [task, taskId]);

  const selectedTaskSessions = taskId ? (taskSessionsByTaskId.get(taskId) ?? []) : [];
  const selectedActiveSessionContext = taskId
    ? activeTaskSessionContextByTaskId.get(taskId)
    : undefined;

  return (
    <TaskDetailsSheet
      activeRepo={activeRepo}
      task={task}
      allTasks={allTasks}
      runs={runs}
      taskSessions={selectedTaskSessions}
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
      onOpenSession={onOpenSession}
      {...(onDelegate ? { onDelegate } : {})}
      {...(onEdit ? { onEdit } : {})}
      {...(onDefer ? { onDefer } : {})}
      {...(onResumeDeferred ? { onResumeDeferred } : {})}
      {...(onHumanApprove ? { onHumanApprove } : {})}
      {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
      {...(onResetImplementation ? { onResetImplementation } : {})}
      {...(onDetectPullRequest ? { onDetectPullRequest } : {})}
      {...(onUnlinkPullRequest ? { onUnlinkPullRequest } : {})}
      {...(detectingPullRequestTaskId !== undefined ? { detectingPullRequestTaskId } : {})}
      {...(unlinkingPullRequestTaskId !== undefined ? { unlinkingPullRequestTaskId } : {})}
      {...(onDelete ? { onDelete } : {})}
    />
  );
});
