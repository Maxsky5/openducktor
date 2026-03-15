import type { TaskCard } from "@openducktor/contracts";
import {
  forwardRef,
  type ReactElement,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { TaskDetailsSheet } from "./task-details-sheet";
import type { TaskDetailsSheetProps } from "./task-details-sheet-types";

export type TaskDetailsSheetControllerHandle = {
  openTask: (taskId: string) => void;
  close: () => void;
};

export type TaskDetailsSheetControllerProps = Omit<
  TaskDetailsSheetProps,
  "task" | "open" | "onOpenChange"
> & {
  allTasks: TaskCard[];
  activeTaskId?: string | null;
  onActiveTaskIdChange?: (taskId: string | null) => void;
};

export const TaskDetailsSheetController = forwardRef<
  TaskDetailsSheetControllerHandle,
  TaskDetailsSheetControllerProps
>(function TaskDetailsSheetController(
  {
    allTasks,
    activeTaskId,
    onActiveTaskIdChange,
    runs,
    workflowActionsEnabled,
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
        onActiveTaskIdChange?.(nextTaskId);
      },
      close: () => {
        setTaskId(null);
        onActiveTaskIdChange?.(null);
      },
    }),
    [onActiveTaskIdChange],
  );

  useEffect(() => {
    if (taskId && !task) {
      setTaskId(null);
      onActiveTaskIdChange?.(null);
    }
  }, [onActiveTaskIdChange, task, taskId]);

  useEffect(() => {
    if (activeTaskId === undefined || activeTaskId === taskId) {
      return;
    }
    setTaskId(activeTaskId);
  }, [activeTaskId, taskId]);

  return (
    <TaskDetailsSheet
      task={task}
      allTasks={allTasks}
      runs={runs}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setTaskId(null);
          onActiveTaskIdChange?.(null);
        }
      }}
      {...(workflowActionsEnabled !== undefined ? { workflowActionsEnabled } : {})}
      {...(onPlan ? { onPlan } : {})}
      {...(onQaStart ? { onQaStart } : {})}
      {...(onQaOpen ? { onQaOpen } : {})}
      {...(onBuild ? { onBuild } : {})}
      {...(onDelegate ? { onDelegate } : {})}
      {...(onEdit ? { onEdit } : {})}
      {...(onDefer ? { onDefer } : {})}
      {...(onResumeDeferred ? { onResumeDeferred } : {})}
      {...(onHumanApprove ? { onHumanApprove } : {})}
      {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
      {...(onDetectPullRequest ? { onDetectPullRequest } : {})}
      {...(onUnlinkPullRequest ? { onUnlinkPullRequest } : {})}
      {...(detectingPullRequestTaskId !== undefined ? { detectingPullRequestTaskId } : {})}
      {...(unlinkingPullRequestTaskId !== undefined ? { unlinkingPullRequestTaskId } : {})}
      {...(onDelete ? { onDelete } : {})}
    />
  );
});
