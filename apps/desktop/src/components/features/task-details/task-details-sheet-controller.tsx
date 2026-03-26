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

type TaskDetailsSheetControllerProps = Omit<
  TaskDetailsSheetProps,
  "task" | "open" | "onOpenChange"
> & {
  allTasks: TaskCard[];
};

export const TaskDetailsSheetController = forwardRef<
  TaskDetailsSheetControllerHandle,
  TaskDetailsSheetControllerProps
>(function TaskDetailsSheetController(
  {
    activeRepo = null,
    allTasks,
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

  return (
    <TaskDetailsSheet
      activeRepo={activeRepo}
      task={task}
      allTasks={allTasks}
      runs={runs}
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
